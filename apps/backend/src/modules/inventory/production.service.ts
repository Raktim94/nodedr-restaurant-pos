import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CorrectProductionDto,
  ProductionEntryDto,
  ProductionLineDto,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { localDate } from '../../common/time';
import { toCsv } from '../reports/csv';
import { StockService } from './stock.service';
import { costVoucher, RECOVERY_CATEGORY } from './manufacturing-alloc';
import { toBaseQuantity, type StockUnit } from './units';

/** What the caller is allowed to do beyond recording: set by the controller from the signed-in user's permissions. */
export interface PostOpts {
  canPrice?: boolean;
}

type Tx = Prisma.TransactionClient;
const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface ResolvedLine {
  role: 'INPUT' | 'OUTPUT';
  ingredientId: string;
  name: string;
  enteredQuantity: Prisma.Decimal;
  enteredUnit: StockUnit;
  quantity: Prisma.Decimal; // in the item's stock unit
  rate: Prisma.Decimal | null; // costing only: per STOCK unit, as typed (null = use the item's average cost)
  baseUnit: StockUnit;
  currentStock: Prisma.Decimal;
  rejected: Prisma.Decimal; // OUTPUT only, stock unit
  locationId: string | null;
  locationName: string | null;
  lotNumber: string | null;
  expected: Prisma.Decimal | null; // stock unit: recipe expectation (INPUT) or planned output (OUTPUT)
  directTo: string | null; // INPUT: output ingredient id
  percent: Prisma.Decimal | null; // OUTPUT: manual split
}

export interface ProductionFilters {
  from?: Date;
  to?: Date;
  productId?: string;
  location?: string;
  shift?: string;
  employeeId?: string;
  status?: 'DRAFT' | 'POSTED' | 'VOIDED';
}

const ENTRY_INCLUDE = {
  lines: {
    include: {
      ingredient: { select: { id: true, name: true, unit: true, kind: true } },
    },
  },
  correctsEntry: { select: { id: true, entryNo: true } },
  correctedBy: { select: { id: true, entryNo: true, status: true } },
} satisfies Prisma.ProductionEntryInclude;

// Daily production recorded as it really happened: the raw material actually used and the finished
// quantity actually produced. There is no recipe and no per-unit cost anywhere in this file. Posting is
// one transaction, so either every deduction and addition lands or none does; a posted entry is
// reversed (voided) or replaced through a correction, never edited.
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // ---- line handling -----------------------------------------------------------------------

  private async resolveLines(
    tx: Tx,
    branchId: string,
    inputs: ProductionLineDto[],
    outputs: ProductionLineDto[],
  ): Promise<ResolvedLine[]> {
    const wanted = [
      ...inputs.map((l) => ({ ...l, role: 'INPUT' as const })),
      ...outputs.map((l) => ({ ...l, role: 'OUTPUT' as const })),
    ];
    const ids = [...new Set(wanted.map((l) => l.ingredientId))];
    const rows = await tx.ingredient.findMany({
      where: { id: { in: ids }, branchId },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const outputIds = new Set(outputs.map((o) => o.ingredientId));
    const seen = new Set<string>();
    const locIds = [
      ...new Set(
        wanted.map((l) => l.locationId).filter((x): x is string => !!x),
      ),
    ];
    const locs = new Map(
      (
        await tx.stockLocation.findMany({
          where: { id: { in: locIds }, branchId },
        })
      ).map((x) => [x.id, x]),
    );

    return wanted.map((l) => {
      const ing = byId.get(l.ingredientId);
      if (!ing)
        throw new NotFoundException('A stock item on this entry was not found');
      if (!ing.isActive)
        throw new BadRequestException(`${ing.name} is inactive`);
      if (l.role === 'OUTPUT') {
        if (ing.kind !== 'PREPARED') {
          throw new BadRequestException(
            `${ing.name} is a raw material. Pick a finished product (create one under Stock items with type "Finished product").`,
          );
        }
      } else if (outputIds.has(l.ingredientId)) {
        throw new BadRequestException(
          `${ing.name} cannot be both used and produced in one entry`,
        );
      }
      const key = `${l.role}:${l.ingredientId}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          `${ing.name} is listed twice; combine it into one row`,
        );
      }
      seen.add(key);
      const entered = Dec(l.quantity);
      const qty = toBaseQuantity(
        entered,
        l.unit,
        ing.unit,
        ing.conversions,
        ing.name,
      );
      const loc = l.locationId ? locs.get(l.locationId) : undefined;
      if (l.locationId && !loc)
        throw new BadRequestException(
          `The place chosen for ${ing.name} was not found`,
        );
      if (loc && !loc.isActive)
        throw new BadRequestException(
          `${loc.name} is switched off; choose another place for ${ing.name}`,
        );
      const conv = (v: string | undefined) =>
        v === undefined || v === ''
          ? null
          : toBaseQuantity(Dec(v), l.unit, ing.unit, ing.conversions, ing.name);
      const rejected = conv(l.rejectedQuantity);
      if (rejected && l.role === 'INPUT')
        throw new BadRequestException(
          `${ing.name}: only a finished product can have rejected pieces`,
        );
      if (rejected && rejected.isNegative())
        throw new BadRequestException(
          `${ing.name}: rejected quantity cannot be negative`,
        );
      if (
        l.directToIngredientId &&
        (l.role !== 'INPUT' || !outputIds.has(l.directToIngredientId))
      )
        throw new BadRequestException(
          `${ing.name} is tied to a product that is not on this voucher`,
        );
      return {
        role: l.role,
        ingredientId: ing.id,
        name: ing.name,
        enteredQuantity: entered,
        enteredUnit: l.unit,
        quantity: qty,
        rate: l.rate !== undefined && l.rate !== '' ? Dec(l.rate) : null,
        baseUnit: ing.unit,
        currentStock: Dec(ing.currentStock),
        rejected: rejected ?? Dec(0),
        locationId: loc?.id ?? null,
        locationName: loc?.name ?? null,
        lotNumber: l.lotNumber?.trim() || null,
        expected: conv(l.expectedQuantity),
        directTo: l.role === 'INPUT' ? (l.directToIngredientId ?? null) : null,
        percent:
          l.role === 'OUTPUT' &&
          l.allocationPercent !== undefined &&
          l.allocationPercent !== ''
            ? Dec(l.allocationPercent)
            : null,
      };
    });
  }

  /** Columns stored for a line (used when creating and when rewriting a draft). */
  private lineData(l: ResolvedLine) {
    return {
      role: l.role,
      ingredientId: l.ingredientId,
      enteredQuantity: l.enteredQuantity,
      enteredUnit: l.enteredUnit,
      quantity: l.quantity,
      unitRate: l.role === 'INPUT' ? l.rate : null,
      rejectedQuantity: l.rejected,
      locationId: l.locationId,
      locationName: l.locationName,
      lotNumber: l.lotNumber,
      expectedQuantity: l.expected,
      directToIngredientId: l.directTo,
      allocationPercent: l.role === 'OUTPUT' ? l.percent : null,
    };
  }

  /** Recipe actually used and the PO this run started from, copied into the voucher so later edits never rewrite it. */
  private async entryExtras(
    tx: Tx,
    branchId: string,
    dto: Pick<ProductionEntryDto, 'recipe' | 'sourcePoId' | 'allocationMethod'>,
  ) {
    const out: Record<string, unknown> = {};
    if (dto.recipe) {
      if (dto.recipe.kind === 'RECIPE') {
        const r = await tx.productRecipe.findFirst({
          where: { id: dto.recipe.id, branchId },
          include: {
            lines: { include: { ingredient: { select: { name: true } } } },
          },
        });
        if (!r) throw new NotFoundException('That recipe was not found');
        Object.assign(out, {
          recipeKind: 'RECIPE',
          recipeId: r.id,
          recipeName: `${r.name} (v${r.version})`,
          recipeSnapshot: {
            kind: 'RECIPE',
            id: r.id,
            name: r.name,
            version: r.version,
            outputIngredientId: r.outputIngredientId,
            baseOutputQty: r.baseOutputQty.toString(),
            lines: r.lines.map((x) => ({
              ingredientId: x.ingredientId,
              name: x.ingredient.name,
              quantity: x.quantity.toString(),
              unit: x.unit,
            })),
          },
        });
      } else {
        const m = await tx.menuItem.findFirst({
          where: { id: dto.recipe.id, branchId },
          include: {
            recipeLines: {
              include: { ingredient: { select: { name: true, unit: true } } },
            },
            costing: { select: { batchOutputQty: true, version: true } },
          },
        });
        if (!m || !m.recipeLines.length)
          throw new NotFoundException('That menu recipe was not found');
        Object.assign(out, {
          recipeKind: 'MENU',
          recipeId: m.id,
          recipeName: `${m.name} (menu recipe)`,
          recipeSnapshot: {
            kind: 'MENU',
            id: m.id,
            name: m.name,
            version: m.costing?.version ?? 1,
            outputIngredientId: m.stockIngredientId,
            baseOutputQty: (m.costing?.batchOutputQty ?? Dec(1)).toString(),
            lines: m.recipeLines.map((x) => ({
              ingredientId: x.ingredientId,
              name: x.ingredient.name,
              quantity: x.quantity.toString(),
              unit: x.unit ?? x.ingredient.unit,
            })),
          },
        });
      }
    }
    if (dto.sourcePoId) {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: dto.sourcePoId, branchId },
        include: { supplier: { select: { name: true } } },
      });
      if (!po) throw new NotFoundException('That purchase order was not found');
      Object.assign(out, {
        sourcePoId: po.id,
        sourcePoNumber: po.poNumber,
        sourceSupplier: po.supplier.name,
      });
    }
    if (dto.allocationMethod) out.allocationMethod = dto.allocationMethod;
    return out;
  }

  /** Move how much of an item is recorded in one place. Taking more than the place holds is refused. */
  private async shiftLevel(
    tx: Tx,
    ingredientId: string,
    locationId: string,
    delta: Prisma.Decimal,
    what: { name: string; unit: string; place: string },
    clamp = false,
  ) {
    const row = await tx.stockLevel.findUnique({
      where: { ingredientId_locationId: { ingredientId, locationId } },
    });
    const cur = Dec(row?.quantity ?? 0);
    let next = cur.plus(delta);
    if (next.isNegative()) {
      if (!clamp)
        throw new BadRequestException(
          `Only ${cur.toString()} ${what.unit} of ${what.name} is recorded in ${what.place}. Move stock there first, or choose another place.`,
        );
      next = Dec(0); // reversing: the item has since moved on; the total stays right and "unassigned" absorbs the difference
    }
    await tx.stockLevel.upsert({
      where: { ingredientId_locationId: { ingredientId, locationId } },
      create: { ingredientId, locationId, quantity: next },
      update: { quantity: next },
    });
  }

  private async nextEntryNo(
    tx: Tx,
    branchId: string,
    at: Date,
  ): Promise<string> {
    // One writer at a time per branch, so two phones cannot both take PR-...-003.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production:' + branchId}))`;
    // The voucher number carries the restaurant's local date (Asia/Kolkata unless it set another zone).
    const b = await tx.branch.findUnique({
      where: { id: branchId },
      select: { restaurant: { select: { timezone: true } } },
    });
    const day = localDate(at, b?.restaurant.timezone ?? 'Asia/Kolkata').replace(
      /-/g,
      '',
    );
    const prefix = `PR-${day}-`;
    // Highest number used that day, not a count: deleting a draft must never hand its number to a second entry
    // (a count would, and the unique constraint would then refuse the next save).
    const last = await tx.productionEntry.findFirst({
      where: { branchId, entryNo: { startsWith: prefix } },
      orderBy: { entryNo: 'desc' },
      select: { entryNo: true },
    });
    const n = last ? Number(last.entryNo.slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(3, '0')}`;
  }

  // ---- preview (the review step; writes nothing) --------------------------------------------

  async preview(
    branchId: string,
    dto: Pick<ProductionEntryDto, 'inputs' | 'outputs'>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lines = await this.resolveLines(
        tx,
        branchId,
        dto.inputs,
        dto.outputs,
      );
      const view = lines.map((l) => {
        const after =
          l.role === 'INPUT'
            ? l.currentStock.minus(l.quantity)
            : l.currentStock.plus(l.quantity);
        return {
          role: l.role,
          ingredientId: l.ingredientId,
          name: l.name,
          entered: `${l.enteredQuantity.toString()} ${l.enteredUnit}`,
          quantity: l.quantity.toString(),
          unit: l.baseUnit,
          balanceBefore: l.currentStock.toString(),
          balanceAfter: after.toString(),
          short:
            l.role === 'INPUT' && after.lt(0) ? after.abs().toString() : null,
        };
      });
      return { lines: view, canPost: view.every((v) => !v.short) };
    });
  }

  /**
   * Everything the voucher screen shows before posting, computed here (the browser's numbers are never trusted).
   * Writes nothing. A cost problem (missing rate, incomplete split) is returned as a message with no per-product cost,
   * never as a made-up number.
   */
  async voucherPreview(
    branchId: string,
    dto: Pick<
      ProductionEntryDto,
      'inputs' | 'outputs' | 'costing' | 'allocationMethod'
    >,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lines = await this.resolveLines(
        tx,
        branchId,
        dto.inputs,
        dto.outputs,
      );
      const ings = new Map(
        (
          await tx.ingredient.findMany({
            where: { id: { in: lines.map((l) => l.ingredientId) } },
          })
        ).map((i) => [i.id, i]),
      );
      const levels = await tx.stockLevel.findMany({
        where: {
          ingredientId: { in: lines.map((l) => l.ingredientId) },
          locationId: {
            in: lines.map((l) => l.locationId).filter((x): x is string => !!x),
          },
        },
      });
      const levelOf = (l: ResolvedLine) =>
        l.locationId
          ? Dec(
              levels.find(
                (x) =>
                  x.ingredientId === l.ingredientId &&
                  x.locationId === l.locationId,
              )?.quantity ?? 0,
            )
          : null;
      const inputs = lines.filter((l) => l.role === 'INPUT');
      const outs = lines.filter((l) => l.role === 'OUTPUT');
      const rateFor = (l: ResolvedLine) => {
        const ing = ings.get(l.ingredientId)!;
        return (
          l.rate ?? (Dec(ing.costPerUnit).gt(0) ? Dec(ing.costPerUnit) : null)
        );
      };
      const shortages: string[] = [];
      const inView = inputs.map((l) => {
        const lvl = levelOf(l);
        const short = Dec(l.currentStock).lt(l.quantity);
        const shortHere = lvl !== null && lvl.lt(l.quantity);
        if (short)
          shortages.push(
            `${l.name}: only ${l.currentStock.toString()} ${l.baseUnit} in stock`,
          );
        else if (shortHere)
          shortages.push(
            `${l.name}: only ${lvl.toString()} ${l.baseUnit} recorded in ${l.locationName}`,
          );
        const r = rateFor(l);
        const exp = l.expected;
        return {
          ingredientId: l.ingredientId,
          name: l.name,
          unit: l.baseUnit,
          quantity: l.quantity.toString(),
          onHand: l.currentStock.toString(),
          atLocation: lvl ? lvl.toString() : null,
          location: l.locationName,
          rate: r ? r.toString() : null,
          rateSource: l.rate ? 'typed' : r ? 'average cost' : 'missing',
          lineCost: r
            ? l.quantity
                .mul(r)
                .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
                .toString()
            : null,
          expected: exp ? exp.toString() : null,
          variance: exp ? l.quantity.minus(exp).toString() : null,
          variancePercent:
            exp && exp.gt(0)
              ? l.quantity
                  .minus(exp)
                  .div(exp)
                  .mul(100)
                  .toDecimalPlaces(1)
                  .toString()
              : null,
        };
      });
      const missingRates = inView
        .filter((r) => r.rate === null)
        .map((r) => r.name);
      let calc: ReturnType<typeof costVoucher> | null = null;
      let costError: string | null = null;
      const c = dto.costing;
      if (c && c.enabled) {
        if (missingRates.length)
          costError = `No cost yet for: ${missingRates.join(', ')}. Type a rate or receive it with a cost.`;
        else {
          try {
            calc = this.voucherCost(lines, c.costs, dto.allocationMethod, {
              rateFor: (l) => rateFor(l)!,
            });
          } catch (e) {
            if (e instanceof BadRequestException)
              costError =
                (e.getResponse() as { message?: string }).message ?? e.message;
            else throw e;
          }
        }
      }
      const outView = outs.map((l) => {
        const a = calc?.outputs.find((x) => x.key === l.ingredientId);
        const total = l.quantity.plus(l.rejected);
        return {
          ingredientId: l.ingredientId,
          name: l.name,
          unit: l.baseUnit,
          good: l.quantity.toString(),
          rejected: l.rejected.toString(),
          rejectRate: total.gt(0)
            ? l.rejected.div(total).mul(100).toDecimalPlaces(1).toString()
            : '0',
          location: l.locationName,
          expected: l.expected ? l.expected.toString() : null,
          yieldPercent:
            l.expected && l.expected.gt(0)
              ? l.quantity
                  .div(l.expected)
                  .mul(100)
                  .toDecimalPlaces(1)
                  .toString()
              : null,
          percent: a?.percent.toString() ?? null,
          directMaterial: a?.directMaterial.toString() ?? null,
          allocatedCost: a?.allocatedCost.toString() ?? null,
          unitCost: a?.unitCost.toString() ?? null,
        };
      });
      // Totals do not depend on the split, so they are shown even while the split is incomplete.
      const ingredientCost = missingRates.length
        ? null
        : inView.reduce((sum, r) => sum.plus(r.lineCost ?? 0), Dec(0));
      const gross = (c?.costs ?? [])
        .filter((x) => x.included && x.category !== RECOVERY_CATEGORY)
        .reduce((sum, x) => sum.plus(x.amount || 0), Dec(0));
      const recovery = (c?.costs ?? [])
        .filter((x) => x.included && x.category === RECOVERY_CATEGORY)
        .reduce((sum, x) => sum.plus(x.amount || 0), Dec(0));
      return {
        costed: !!(c && c.enabled),
        rateBasis:
          'Weighted average cost of each item (a typed rate overrides it); frozen when posted.',
        wastageTreatment:
          'Rejected pieces are not stocked; their cost stays in the batch and is carried by the good units.',
        inputs: inView,
        outputs: outView,
        ingredientCost: ingredientCost?.toString() ?? null,
        additionalCost: ingredientCost
          ? gross.minus(recovery).toString()
          : null,
        recovery: recovery.toString(),
        totalCost: ingredientCost
          ? ingredientCost.plus(gross).minus(recovery).toString()
          : null,
        method: calc?.method ?? dto.allocationMethod ?? null,
        costError,
        shortages,
        canPost:
          shortages.length === 0 &&
          (!(c && c.enabled) || (!costError && !!calc)),
      };
    });
  }

  // ---- create / update draft -----------------------------------------------------------------

  async create(
    branchId: string,
    userId: string,
    dto: ProductionEntryDto,
    opts: PostOpts = {},
  ) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.productionEntry.findUnique({
        where: {
          branchId_idempotencyKey: {
            branchId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        include: ENTRY_INCLUDE,
      });
      if (existing) return existing; // a retried upload: same result, nothing posted twice
    }
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const entry = await this.createInTx(
          tx,
          branchId,
          userId,
          dto,
          undefined,
          opts,
        );
        if (dto.post)
          await this.postInTx(
            tx,
            branchId,
            userId,
            entry.id,
            dto.deviceId,
            opts,
          );
        return entry.id;
      });
      return this.get(branchId, id);
    } catch (e) {
      // Two uploads of the same event racing each other: the loser reads the winner.
      if (
        dto.idempotencyKey &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.productionEntry.findUnique({
          where: {
            branchId_idempotencyKey: {
              branchId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          include: ENTRY_INCLUDE,
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  private async createInTx(
    tx: Tx,
    branchId: string,
    userId: string,
    dto: Omit<ProductionEntryDto, 'post'>,
    correctsEntryId?: string,
    opts: PostOpts = {},
  ) {
    const lines = await this.resolveLines(
      tx,
      branchId,
      dto.inputs,
      dto.outputs,
    );
    const fin = await this.costingFields(tx, branchId, dto, lines, opts);
    const extras = await this.entryExtras(tx, branchId, dto);
    const producedAt = dto.producedAt ?? new Date();
    const entryNo = await this.nextEntryNo(tx, branchId, producedAt);
    return tx.productionEntry.create({
      data: {
        branchId,
        entryNo,
        producedAt,
        shift: dto.shift,
        location: dto.location,
        batchRef: dto.batchRef,
        notes: dto.notes,
        responsibleId: dto.responsibleId ?? userId,
        idempotencyKey: dto.idempotencyKey,
        deviceId: dto.deviceId,
        correctsEntryId,
        createdById: userId,
        manufacturedOn: dto.manufacturedOn,
        expiryDate: dto.expiryDate,
        ...fin.entry,
        ...extras,
        costs: { create: fin.costs },
        lines: { create: lines.map((l) => this.lineData(l)) },
      },
    });
  }

  /**
   * The one place a voucher's cost is worked out, for drafts, previews and posting alike.
   * Rates: the typed rate, else the item's weighted-average cost (Ingredient.costPerUnit, moved by receipts and by
   * costed production). `rateFor` supplies that average; a draft passes none and uses 0 only to check the shape.
   */
  private voucherCost(
    lines: ResolvedLine[],
    costs: {
      category: string;
      description?: string | null;
      amount: Prisma.Decimal.Value;
      included: boolean;
    }[],
    method: 'QUANTITY' | 'MANUAL' | undefined,
    o: { draft?: boolean; rateFor?: (l: ResolvedLine) => Prisma.Decimal } = {},
  ) {
    const outs = lines.filter((l) => l.role === 'OUTPUT');
    return costVoucher({
      inputs: lines
        .filter((l) => l.role === 'INPUT')
        .map((l) => ({
          key: l.ingredientId,
          name: l.name,
          quantity: l.quantity,
          rate: o.rateFor ? o.rateFor(l) : (l.rate ?? 0),
          directTo: l.directTo,
        })),
      outputs: outs.map((l) => ({
        key: l.ingredientId,
        name: l.name,
        goodQty: l.quantity,
        unit: l.baseUnit,
        percent: l.percent,
      })),
      costs: costs.map((x) => ({ ...x })),
      method: method ?? null,
    });
  }

  /** Validates the costing part of a draft and returns what to store. Nothing is calculated or frozen until posting. */
  private async costingFields(
    tx: Tx,
    branchId: string,
    dto: Omit<ProductionEntryDto, 'post'>,
    lines: ResolvedLine[],
    opts: PostOpts,
  ) {
    const none = {
      entry: {},
      costs: [] as {
        category: string;
        description: string | null;
        amount: Prisma.Decimal;
        included: boolean;
      }[],
    };
    const c = dto.costing;
    if (!c || !c.enabled) return none;
    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { restaurant: { select: { manufacturingEnabled: true } } },
    });
    if (!branch.restaurant.manufacturingEnabled)
      throw new BadRequestException(
        'Manufacturing costing is switched off for this restaurant. An admin can turn it on in Settings.',
      );
    const outputs = lines.filter((l) => l.role === 'OUTPUT');
    // Shape and numbers are checked here too (not only at posting) so a bad draft cannot be saved.
    this.voucherCost(lines, c.costs, dto.allocationMethod, { draft: true });
    const costs = c.costs.map((x) => ({
      category: x.category.trim(),
      description: x.description?.trim() || null,
      amount: Dec(x.amount),
      included: x.included,
    }));
    const entry: Record<string, unknown> = { costed: true };
    if (c.menuPrice) {
      if (outputs.length !== 1)
        throw new BadRequestException(
          'A menu price can be changed only from a voucher that makes one product.',
        );
      if (!opts.canPrice)
        throw new ForbiddenException(
          'You can record production, but changing a menu price needs the menu price permission.',
        );
      const np = Dec(c.menuPrice.newPrice);
      if (!np.isFinite() || np.lte(0) || np.decimalPlaces() > 2)
        throw new BadRequestException(
          'The new menu price must be more than zero, with at most 2 decimals',
        );
      const mi = await tx.menuItem.findFirst({
        where: { id: c.menuPrice.menuItemId, branchId },
      });
      if (!mi) throw new NotFoundException('Menu item not found');
      if (mi.stockIngredientId !== outputs[0].ingredientId)
        throw new BadRequestException(
          'That menu item is not the finished product of this batch. Link it under Menu > Stock when sold first.',
        );
      Object.assign(entry, {
        priceMenuItemId: mi.id,
        proposedPrice: np,
        expectedPrice: Dec(c.menuPrice.expectedCurrentPrice),
      });
    }
    return { entry, costs };
  }

  async updateDraft(
    branchId: string,
    userId: string,
    id: string,
    dto: Omit<ProductionEntryDto, 'post'>,
    opts: PostOpts = {},
  ) {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.productionEntry.findFirst({
        where: { id, branchId },
      });
      if (!entry) throw new NotFoundException('Production entry not found');
      if (entry.status !== 'DRAFT') {
        throw new BadRequestException(
          'Only a draft can be edited. Reverse a posted entry and record a correction instead.',
        );
      }
      const lines = await this.resolveLines(
        tx,
        branchId,
        dto.inputs,
        dto.outputs,
      );
      const fin = await this.costingFields(tx, branchId, dto, lines, opts);
      const extras = await this.entryExtras(tx, branchId, dto);
      await tx.productionLine.deleteMany({ where: { entryId: id } });
      await tx.productionCost.deleteMany({ where: { entryId: id } });
      await tx.productionEntry.update({
        where: { id },
        data: {
          costed: false,
          priceMenuItemId: null,
          proposedPrice: null,
          expectedPrice: null,
          recipeKind: null,
          recipeId: null,
          recipeName: null,
          recipeSnapshot: Prisma.DbNull,
          sourcePoId: null,
          sourcePoNumber: null,
          sourceSupplier: null,
          allocationMethod: null,
          manufacturedOn: dto.manufacturedOn,
          expiryDate: dto.expiryDate,
          ...fin.entry,
          ...extras,
          costs: { create: fin.costs },
          producedAt: dto.producedAt ?? entry.producedAt,
          shift: dto.shift,
          location: dto.location,
          batchRef: dto.batchRef,
          notes: dto.notes,
          responsibleId: dto.responsibleId ?? entry.responsibleId,
          lines: { create: lines.map((l) => this.lineData(l)) },
        },
      });
    });
    void userId;
    return this.get(branchId, id);
  }

  async deleteDraft(branchId: string, id: string) {
    const r = await this.prisma.productionEntry.deleteMany({
      where: { id, branchId, status: 'DRAFT' },
    });
    if (r.count === 0)
      throw new BadRequestException('Only a draft can be deleted');
    return { ok: true };
  }

  // ---- post ------------------------------------------------------------------------------------

  async post(
    branchId: string,
    userId: string,
    id: string,
    deviceId?: string,
    opts: PostOpts = {},
  ) {
    await this.prisma.$transaction((tx) =>
      this.postInTx(tx, branchId, userId, id, deviceId, opts),
    );
    return this.get(branchId, id);
  }

  /**
   * Record or change the quality inspection of a posted batch. Optional by design: a batch with no inspection
   * shows "Not recorded". The previous result is kept in the audit trail, so a change never erases history.
   */
  async recordQuality(
    branchId: string,
    userId: string,
    id: string,
    dto: {
      result: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
      grade?: string;
      notes?: string;
    },
  ) {
    const e = await this.prisma.productionEntry.findFirst({
      where: { id, branchId },
    });
    if (!e) throw new NotFoundException('Production entry not found');
    if (e.status !== 'POSTED')
      throw new BadRequestException('Only a posted batch can be inspected');
    const grade = dto.grade?.trim() || null;
    const notes = dto.notes?.trim() || null;
    if (dto.result === 'FAIL' && !notes)
      throw new BadRequestException(
        'Say what failed: a failed inspection needs a note',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.productionEntry.update({
        where: { id },
        data: {
          qualityResult: dto.result,
          qualityGrade: grade,
          qualityNotes: notes,
          qualityById: userId,
          qualityAt: new Date(),
        },
      });
      await this.audit.record({
        userId,
        action: 'production.quality',
        entity: 'ProductionEntry',
        entityId: id,
        metadata: {
          entryNo: e.entryNo,
          before: e.qualityResult
            ? {
                result: e.qualityResult,
                grade: e.qualityGrade,
                notes: e.qualityNotes,
                by: e.qualityById,
                at: e.qualityAt,
              }
            : null,
          after: { result: dto.result, grade, notes },
        },
      });
    });
    return this.get(branchId, id);
  }

  private async postInTx(
    tx: Tx,
    branchId: string,
    userId: string,
    id: string,
    deviceId?: string,
    opts: PostOpts = {},
  ) {
    // The conditional update is the guard: a second post of the same draft changes nothing and fails.
    const claimed = await tx.productionEntry.updateMany({
      where: { id, branchId, status: 'DRAFT' },
      data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
    });
    if (claimed.count === 0) {
      const e = await tx.productionEntry.findFirst({ where: { id, branchId } });
      if (!e) throw new NotFoundException('Production entry not found');
      throw new ConflictException(
        `This entry is already ${e.status.toLowerCase()}`,
      );
    }
    const entry = await tx.productionEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: true, costs: true },
    });
    const ids = [...new Set(entry.lines.map((l) => l.ingredientId))].sort();
    // Lock in a fixed order so two batches sharing an ingredient cannot deadlock.
    for (const ingredientId of ids) {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`;
    }
    const refs = { productionEntryId: id, deviceId };

    // Costing is decided and FROZEN here: the rate used is the typed one, or the item's average cost right now.
    // Recipes and ingredient prices changing later never touch these numbers.
    let cost: ReturnType<typeof costVoucher> | null = null;
    const unitCostOf = new Map<string, Prisma.Decimal>(); // output ingredient id -> cost per good unit
    if (entry.costed) {
      const ings = new Map(
        (await tx.ingredient.findMany({ where: { id: { in: ids } } })).map(
          (i) => [i.id, i],
        ),
      );
      const inputs = entry.lines.filter((x) => x.role === 'INPUT');
      const outs = entry.lines.filter((x) => x.role === 'OUTPUT');
      cost = costVoucher({
        inputs: inputs.map((l) => {
          const ing = ings.get(l.ingredientId)!;
          const rate =
            l.unitRate ??
            (Dec(ing.costPerUnit).gt(0) ? Dec(ing.costPerUnit) : null);
          if (rate === null)
            throw new BadRequestException(
              `${ing.name} has no cost yet. Type its cost rate on the batch, or receive it with a cost first.`,
            );
          return {
            key: l.id,
            name: ing.name,
            quantity: l.quantity,
            rate,
            directTo: l.directToIngredientId
              ? (outs.find((o) => o.ingredientId === l.directToIngredientId)
                  ?.id ?? null)
              : null,
          };
        }),
        outputs: outs.map((l) => ({
          key: l.id,
          name: ings.get(l.ingredientId)!.name,
          goodQty: l.quantity,
          unit: ings.get(l.ingredientId)!.unit,
          percent: l.allocationPercent,
        })),
        costs: entry.costs.map((c) => ({
          category: c.category,
          description: c.description,
          amount: c.amount,
          included: c.included,
        })),
        method:
          (entry.allocationMethod as 'QUANTITY' | 'MANUAL' | null) ?? null,
      });
      for (const cl of cost.lines) {
        await tx.productionLine.update({
          where: { id: cl.key },
          data: { unitRate: cl.rate, lineCost: cl.lineCost },
        });
      }
      for (const o of cost.outputs) {
        await tx.productionLine.update({
          where: { id: o.key },
          data: {
            allocationPercent: o.percent,
            allocatedCost: o.allocatedCost,
            goodUnitCost: o.unitCost,
          },
        });
        const line = outs.find((x) => x.id === o.key)!;
        unitCostOf.set(line.ingredientId, o.unitCost);
      }
      await tx.productionEntry.update({
        where: { id },
        data: {
          ingredientCost: cost.ingredientCost,
          additionalCost: cost.additionalCost,
          totalCost: cost.totalCost,
          unitCost: cost.outputs[0].unitCost, // primary output; every output's own cost is on its line
        },
      });
    }
    const note = `Production ${entry.entryNo}`;

    for (const l of entry.lines.filter((x) => x.role === 'INPUT')) {
      const ing = await tx.ingredient.findUniqueOrThrow({
        where: { id: l.ingredientId },
      });
      // Row-level place: the place must hold it (checked before anything is taken), then it is taken from there.
      if (l.locationId)
        await this.shiftLevel(
          tx,
          l.ingredientId,
          l.locationId,
          Dec(l.quantity).negated(),
          {
            name: ing.name,
            unit: ing.unit,
            place: l.locationName ?? 'that place',
          },
        );
      await this.stock.consumeStock(tx, branchId, l.ingredientId, l.quantity, {
        type: 'PRODUCTION_USE',
        note,
        userId,
        allowNegative: false, // never below zero; a manager fixes the count with an adjustment first
        refs,
      });
      if (l.locationId)
        await tx.stockMovement.updateMany({
          where: {
            productionEntryId: id,
            ingredientId: l.ingredientId,
            type: 'PRODUCTION_USE',
            branchId,
          },
          data: { locationId: l.locationId },
        });
    }
    for (const l of entry.lines.filter((x) => x.role === 'OUTPUT')) {
      const ing = await tx.ingredient.findUniqueOrThrow({
        where: { id: l.ingredientId },
      });
      const unitCost = unitCostOf.get(l.ingredientId) ?? null;
      const batch = await tx.stockBatch.create({
        data: {
          branchId,
          ingredientId: l.ingredientId,
          batchNumber: l.lotNumber || entry.batchRef || entry.entryNo,
          quantityReceived: l.quantity,
          quantityRemaining: l.quantity,
          expiryDate: entry.expiryDate ?? undefined,
          unitCost: unitCost ?? 0, // an uncosted batch invents no cost
        },
      });
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: l.ingredientId,
          batchId: batch.id,
          type: 'PRODUCTION',
          quantity: l.quantity, // GOOD pieces only: rejected pieces never become stock
          note: Dec(l.rejectedQuantity).gt(0)
            ? `${note} (${Dec(l.rejectedQuantity).toString()} rejected, not stocked)`
            : note,
          createdById: userId,
          locationId: l.locationId,
          ...refs,
        },
      });
      if (l.locationId)
        await this.shiftLevel(
          tx,
          l.ingredientId,
          l.locationId,
          Dec(l.quantity),
          {
            name: ing.name,
            unit: ing.unit,
            place: l.locationName ?? 'that place',
          },
        );
      // Costed output also moves the finished item's weighted-average cost.
      const oldStock = Dec(ing.currentStock);
      const newAvg = unitCost
        ? oldStock.lte(0)
          ? unitCost
          : oldStock
              .mul(ing.costPerUnit)
              .plus(l.quantity.mul(unitCost))
              .div(oldStock.plus(l.quantity))
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
        : null;
      await tx.ingredient.update({
        where: { id: l.ingredientId },
        data: {
          currentStock: oldStock.plus(l.quantity),
          ...(newAvg ? { costPerUnit: newAvg } : {}),
        },
      });
    }

    // The menu selling price, if the user chose to change it: same transaction, so stock and price succeed or fail together.
    if (entry.costed && entry.priceMenuItemId && entry.proposedPrice) {
      if (!opts.canPrice)
        throw new ForbiddenException(
          'Changing a menu price needs the menu price permission.',
        );
      await tx.$queryRaw`SELECT id FROM menu_items WHERE id = ${entry.priceMenuItemId} FOR UPDATE`;
      const mi = await tx.menuItem.findFirst({
        where: { id: entry.priceMenuItemId, branchId },
      });
      if (!mi) throw new NotFoundException('The menu item no longer exists');
      if (entry.expectedPrice && !Dec(mi.price).equals(entry.expectedPrice)) {
        // Someone changed the price after this form was opened: nothing is posted, the user reviews the latest price.
        throw new ConflictException({
          message: `The menu price changed to ${Dec(mi.price).toFixed(2)} (the form showed ${Dec(entry.expectedPrice).toFixed(2)}). Review the latest price and try again. Nothing was posted.`,
          code: 'PRICE_CONFLICT',
          currentPrice: Dec(mi.price).toFixed(2),
        });
      }
      // The price as it stood when this batch was posted, before the batch changes it: frozen on the entry.
      await tx.productionEntry.update({
        where: { id },
        data: { menuItemId: mi.id, sellingPriceAtPost: mi.price },
      });
      const change = await tx.menuPriceChange.create({
        data: {
          branchId,
          menuItemId: mi.id,
          oldPrice: mi.price,
          newPrice: entry.proposedPrice,
          changedById: userId,
          productionEntryId: id,
          unitCostAtChange: cost?.outputs[0].unitCost ?? null,
        },
      });
      await tx.menuItem.update({
        where: { id: mi.id },
        data: { price: entry.proposedPrice },
      });
      await tx.productionEntry.update({
        where: { id },
        data: { priceChangeId: change.id },
      });
      await this.audit.record({
        userId,
        action: 'menu.price_changed',
        entity: 'MenuItem',
        entityId: mi.id,
        metadata: {
          priceBefore: Number(mi.price),
          priceAfter: Number(entry.proposedPrice),
          productionEntry: entry.entryNo,
        },
      });
    }
    if (entry.costed && !entry.priceMenuItemId) {
      // No price change in this batch: still freeze the menu price in force at posting, for the reports.
      const outId = entry.lines.find((x) => x.role === 'OUTPUT')?.ingredientId;
      const mi = outId
        ? await tx.menuItem.findFirst({
            where: { branchId, stockIngredientId: outId },
            orderBy: { id: 'asc' },
            select: { id: true, price: true },
          })
        : null;
      if (mi)
        await tx.productionEntry.update({
          where: { id },
          data: { menuItemId: mi.id, sellingPriceAtPost: mi.price },
        });
    }
    await this.audit.record({
      userId,
      action: 'production.post',
      entity: 'ProductionEntry',
      entityId: id,
      metadata: { entryNo: entry.entryNo, lines: entry.lines.length },
    });
  }

  // ---- void / correct --------------------------------------------------------------------------

  async void(branchId: string, userId: string, id: string, reason: string) {
    await this.prisma.$transaction((tx) =>
      this.voidInTx(tx, branchId, userId, id, reason),
    );
    return this.get(branchId, id);
  }

  private async voidInTx(
    tx: Tx,
    branchId: string,
    userId: string,
    id: string,
    reason: string,
  ) {
    const claimed = await tx.productionEntry.updateMany({
      where: { id, branchId, status: 'POSTED' },
      data: {
        status: 'VOIDED',
        voidedById: userId,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });
    if (claimed.count === 0) {
      const e = await tx.productionEntry.findFirst({ where: { id, branchId } });
      if (!e) throw new NotFoundException('Production entry not found');
      throw new BadRequestException(
        `Only a posted entry can be reversed (this one is ${e.status.toLowerCase()})`,
      );
    }
    const entry = await tx.productionEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });
    const ids = [...new Set(entry.lines.map((l) => l.ingredientId))].sort();
    for (const ingredientId of ids) {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`;
    }
    const moves = await tx.stockMovement.findMany({
      where: {
        productionEntryId: id,
        branchId,
        type: { in: ['PRODUCTION', 'PRODUCTION_USE'] },
      },
    });
    const note = `Reversal of ${entry.entryNo}: ${reason}`;

    // Finished stock first: if any of it was already sold or wasted the reversal must stop, because
    // taking it back would push the product below what is physically on hand.
    for (const m of moves.filter((x) => x.type === 'PRODUCTION')) {
      const batch = m.batchId
        ? await tx.stockBatch.findUnique({ where: { id: m.batchId } })
        : null;
      const ing = await tx.ingredient.findUniqueOrThrow({
        where: { id: m.ingredientId },
      });
      if (!batch || Dec(batch.quantityRemaining).lt(m.quantity)) {
        throw new BadRequestException(
          `Cannot reverse: some of the ${ing.name} from this batch has already been sold or wasted. Record a stock adjustment instead.`,
        );
      }
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: {
          quantityRemaining: Dec(batch.quantityRemaining).minus(m.quantity),
        },
      });
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: m.ingredientId,
          batchId: batch.id,
          type: 'REVERSAL',
          quantity: Dec(m.quantity).negated(),
          note,
          createdById: userId,
          productionEntryId: id,
          locationId: m.locationId,
        },
      });
      if (m.locationId)
        await this.shiftLevel(
          tx,
          m.ingredientId,
          m.locationId,
          Dec(m.quantity).negated(),
          {
            name: ing.name,
            unit: ing.unit,
            place: 'its place',
          },
          true,
        );
      await tx.ingredient.update({
        where: { id: m.ingredientId },
        data: { currentStock: Dec(ing.currentStock).minus(m.quantity) },
      });
    }
    // Raw materials go back into the batches they were drawn from.
    for (const m of moves.filter((x) => x.type === 'PRODUCTION_USE')) {
      const back = Dec(m.quantity).negated();
      const ing = await tx.ingredient.findUniqueOrThrow({
        where: { id: m.ingredientId },
      });
      if (m.batchId) {
        const batch = await tx.stockBatch.findUnique({
          where: { id: m.batchId },
        });
        if (batch) {
          await tx.stockBatch.update({
            where: { id: batch.id },
            data: {
              quantityRemaining: Dec(batch.quantityRemaining).plus(back),
            },
          });
        }
      }
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: m.ingredientId,
          batchId: m.batchId,
          type: 'REVERSAL',
          quantity: back,
          note,
          createdById: userId,
          productionEntryId: id,
          locationId: m.locationId,
        },
      });
      if (m.locationId)
        await this.shiftLevel(tx, m.ingredientId, m.locationId, back, {
          name: ing.name,
          unit: ing.unit,
          place: 'its place',
        });
      await tx.ingredient.update({
        where: { id: m.ingredientId },
        data: { currentStock: Dec(ing.currentStock).plus(back) },
      });
    }
    await this.audit.record({
      userId,
      action: 'production.void',
      entity: 'ProductionEntry',
      entityId: id,
      metadata: { entryNo: entry.entryNo, reason },
    });
  }

  /** Reverse the posted entry and post a replacement in one transaction, linked both ways. */
  async correct(
    branchId: string,
    userId: string,
    id: string,
    dto: CorrectProductionDto,
    opts: PostOpts = {},
  ) {
    const { reason, ...rest } = dto;
    const newId = await this.prisma.$transaction(async (tx) => {
      await this.voidInTx(tx, branchId, userId, id, `Corrected: ${reason}`);
      const created = await this.createInTx(
        tx,
        branchId,
        userId,
        rest,
        id,
        opts,
      );
      await this.postInTx(tx, branchId, userId, created.id, dto.deviceId, opts);
      return created.id;
    });
    return this.get(branchId, newId);
  }

  // ---- read ------------------------------------------------------------------------------------

  async get(branchId: string, id: string) {
    const e = await this.prisma.productionEntry.findFirst({
      where: { id, branchId },
      include: ENTRY_INCLUDE,
    });
    if (!e) throw new NotFoundException('Production entry not found');
    return e;
  }

  private where(
    branchId: string,
    f: ProductionFilters,
  ): Prisma.ProductionEntryWhereInput {
    return {
      branchId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.location ? { location: f.location } : {}),
      ...(f.shift ? { shift: f.shift } : {}),
      ...(f.employeeId ? { responsibleId: f.employeeId } : {}),
      ...(f.from || f.to
        ? {
            producedAt: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {}),
      ...(f.productId
        ? { lines: { some: { ingredientId: f.productId, role: 'OUTPUT' } } }
        : {}),
    };
  }

  async list(branchId: string, f: ProductionFilters, take = 100) {
    const rows = await this.prisma.productionEntry.findMany({
      where: this.where(branchId, f),
      include: ENTRY_INCLUDE,
      orderBy: { producedAt: 'desc' },
      take: Math.min(take, 500),
    });
    const people = await this.people(
      rows.flatMap((r) => [
        r.responsibleId,
        r.createdById,
        r.postedById,
        r.voidedById,
      ]),
    );
    return rows.map((r) => ({
      ...r,
      responsibleName: r.responsibleId
        ? (people.get(r.responsibleId) ?? null)
        : null,
      createdByName: people.get(r.createdById) ?? null,
    }));
  }

  private async people(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** What was produced and consumed over a period, posted entries only, grouped for the daily report. */
  async report(branchId: string, f: ProductionFilters) {
    const entries = await this.list(branchId, { ...f, status: 'POSTED' }, 500);
    const produced = new Map<
      string,
      {
        ingredientId: string;
        name: string;
        unit: string;
        quantity: Prisma.Decimal;
      }
    >();
    const used = new Map<
      string,
      {
        ingredientId: string;
        name: string;
        unit: string;
        quantity: Prisma.Decimal;
      }
    >();
    for (const e of entries) {
      for (const l of e.lines) {
        const bucket = l.role === 'OUTPUT' ? produced : used;
        const cur = bucket.get(l.ingredientId);
        bucket.set(l.ingredientId, {
          ingredientId: l.ingredientId,
          name: l.ingredient.name,
          unit: l.ingredient.unit,
          quantity: (cur?.quantity ?? Dec(0)).plus(l.quantity),
        });
      }
    }
    const fmt = (
      m: Map<
        string,
        {
          ingredientId: string;
          name: string;
          unit: string;
          quantity: Prisma.Decimal;
        }
      >,
    ) =>
      [...m.values()].map((v) => ({ ...v, quantity: v.quantity.toString() }));
    return {
      entryCount: entries.length,
      produced: fmt(produced),
      consumed: fmt(used),
      entries,
      note: 'Quantities only. No cost is calculated here.',
    };
  }

  async exportCsv(branchId: string, f: ProductionFilters) {
    const entries = await this.list(branchId, f, 500);
    const rows = entries.flatMap((e) =>
      e.lines.map((l) => [
        e.entryNo,
        e.producedAt,
        e.status,
        e.shift,
        e.location,
        e.batchRef,
        e.responsibleName,
        l.role === 'OUTPUT' ? 'Produced' : 'Used',
        l.ingredient.name,
        l.enteredQuantity.toString(),
        l.enteredUnit,
        l.quantity.toString(),
        l.ingredient.unit,
        e.voidReason,
        e.correctsEntry?.entryNo,
      ]),
    );
    return toCsv(
      [
        'Entry',
        'Produced at',
        'Status',
        'Shift',
        'Location',
        'Batch',
        'Responsible',
        'Line',
        'Item',
        'Entered qty',
        'Entered unit',
        'Stock qty',
        'Stock unit',
        'Void reason',
        'Corrects',
      ],
      rows,
    );
  }

  /** Items usually used for a product last time. Hints only: the cook still types the real quantities. */
  async suggestInputs(branchId: string, productId: string) {
    const last = await this.prisma.productionEntry.findFirst({
      where: {
        branchId,
        status: 'POSTED',
        lines: { some: { ingredientId: productId, role: 'OUTPUT' } },
      },
      orderBy: { producedAt: 'desc' },
      include: {
        lines: {
          where: { role: 'INPUT' },
          include: {
            ingredient: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    });
    return (last?.lines ?? []).map((l) => ({
      ingredientId: l.ingredientId,
      name: l.ingredient.name,
      unit: l.enteredUnit,
      lastQuantity: l.enteredQuantity.toString(),
    }));
  }
}
