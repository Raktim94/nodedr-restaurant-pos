import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CorrectProductionDto, ProductionEntryDto, ProductionLineDto } from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toCsv } from '../reports/csv';
import { StockService } from './stock.service';
import { toBaseQuantity, type StockUnit } from './units';

type Tx = Prisma.TransactionClient;
const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface ResolvedLine {
  role: 'INPUT' | 'OUTPUT';
  ingredientId: string;
  name: string;
  enteredQuantity: Prisma.Decimal;
  enteredUnit: StockUnit;
  quantity: Prisma.Decimal; // in the item's stock unit
  baseUnit: StockUnit;
  currentStock: Prisma.Decimal;
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
  lines: { include: { ingredient: { select: { id: true, name: true, unit: true, kind: true } } } },
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
    const rows = await tx.ingredient.findMany({ where: { id: { in: ids }, branchId } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const outputIds = new Set(outputs.map((o) => o.ingredientId));
    const seen = new Set<string>();

    return wanted.map((l) => {
      const ing = byId.get(l.ingredientId);
      if (!ing) throw new NotFoundException('A stock item on this entry was not found');
      if (!ing.isActive) throw new BadRequestException(`${ing.name} is inactive`);
      if (l.role === 'OUTPUT') {
        if (ing.kind !== 'PREPARED') {
          throw new BadRequestException(
            `${ing.name} is a raw material. Pick a finished product (create one under Stock items with type "Finished product").`,
          );
        }
      } else if (outputIds.has(l.ingredientId)) {
        throw new BadRequestException(`${ing.name} cannot be both used and produced in one entry`);
      }
      const key = `${l.role}:${l.ingredientId}`;
      if (seen.has(key)) {
        throw new BadRequestException(`${ing.name} is listed twice; combine it into one row`);
      }
      seen.add(key);
      const entered = Dec(l.quantity);
      const qty = toBaseQuantity(entered, l.unit as StockUnit, ing.unit as StockUnit, ing.conversions, ing.name);
      return {
        role: l.role,
        ingredientId: ing.id,
        name: ing.name,
        enteredQuantity: entered,
        enteredUnit: l.unit as StockUnit,
        quantity: qty,
        baseUnit: ing.unit as StockUnit,
        currentStock: Dec(ing.currentStock),
      };
    });
  }

  private async nextEntryNo(tx: Tx, branchId: string, at: Date): Promise<string> {
    // One writer at a time per branch, so two phones cannot both take PR-...-003.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'production:' + branchId}))`;
    const day = at.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PR-${day}-`;
    const n = await tx.productionEntry.count({ where: { branchId, entryNo: { startsWith: prefix } } });
    return `${prefix}${String(n + 1).padStart(3, '0')}`;
  }

  // ---- preview (the review step; writes nothing) --------------------------------------------

  async preview(branchId: string, dto: Pick<ProductionEntryDto, 'inputs' | 'outputs'>) {
    return this.prisma.$transaction(async (tx) => {
      const lines = await this.resolveLines(tx, branchId, dto.inputs, dto.outputs);
      const view = lines.map((l) => {
        const after = l.role === 'INPUT' ? l.currentStock.minus(l.quantity) : l.currentStock.plus(l.quantity);
        return {
          role: l.role,
          ingredientId: l.ingredientId,
          name: l.name,
          entered: `${l.enteredQuantity.toString()} ${l.enteredUnit}`,
          quantity: l.quantity.toString(),
          unit: l.baseUnit,
          balanceBefore: l.currentStock.toString(),
          balanceAfter: after.toString(),
          short: l.role === 'INPUT' && after.lt(0) ? after.abs().toString() : null,
        };
      });
      return { lines: view, canPost: view.every((v) => !v.short) };
    });
  }

  // ---- create / update draft -----------------------------------------------------------------

  async create(branchId: string, userId: string, dto: ProductionEntryDto) {
    if (dto.idempotencyKey) {
      const existing = await this.prisma.productionEntry.findUnique({
        where: { branchId_idempotencyKey: { branchId, idempotencyKey: dto.idempotencyKey } },
        include: ENTRY_INCLUDE,
      });
      if (existing) return existing; // a retried upload: same result, nothing posted twice
    }
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const entry = await this.createInTx(tx, branchId, userId, dto);
        if (dto.post) await this.postInTx(tx, branchId, userId, entry.id, dto.deviceId);
        return entry.id;
      });
      return this.get(branchId, id);
    } catch (e) {
      // Two uploads of the same event racing each other: the loser reads the winner.
      if (dto.idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.productionEntry.findUnique({
          where: { branchId_idempotencyKey: { branchId, idempotencyKey: dto.idempotencyKey } },
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
  ) {
    const lines = await this.resolveLines(tx, branchId, dto.inputs, dto.outputs);
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
        lines: {
          create: lines.map((l) => ({
            role: l.role,
            ingredientId: l.ingredientId,
            enteredQuantity: l.enteredQuantity,
            enteredUnit: l.enteredUnit,
            quantity: l.quantity,
          })),
        },
      },
    });
  }

  async updateDraft(branchId: string, userId: string, id: string, dto: Omit<ProductionEntryDto, 'post'>) {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.productionEntry.findFirst({ where: { id, branchId } });
      if (!entry) throw new NotFoundException('Production entry not found');
      if (entry.status !== 'DRAFT') {
        throw new BadRequestException('Only a draft can be edited. Reverse a posted entry and record a correction instead.');
      }
      const lines = await this.resolveLines(tx, branchId, dto.inputs, dto.outputs);
      await tx.productionLine.deleteMany({ where: { entryId: id } });
      await tx.productionEntry.update({
        where: { id },
        data: {
          producedAt: dto.producedAt ?? entry.producedAt,
          shift: dto.shift,
          location: dto.location,
          batchRef: dto.batchRef,
          notes: dto.notes,
          responsibleId: dto.responsibleId ?? entry.responsibleId,
          lines: {
            create: lines.map((l) => ({
              role: l.role,
              ingredientId: l.ingredientId,
              enteredQuantity: l.enteredQuantity,
              enteredUnit: l.enteredUnit,
              quantity: l.quantity,
            })),
          },
        },
      });
    });
    void userId;
    return this.get(branchId, id);
  }

  async deleteDraft(branchId: string, id: string) {
    const r = await this.prisma.productionEntry.deleteMany({ where: { id, branchId, status: 'DRAFT' } });
    if (r.count === 0) throw new BadRequestException('Only a draft can be deleted');
    return { ok: true };
  }

  // ---- post ------------------------------------------------------------------------------------

  async post(branchId: string, userId: string, id: string, deviceId?: string) {
    await this.prisma.$transaction((tx) => this.postInTx(tx, branchId, userId, id, deviceId));
    return this.get(branchId, id);
  }

  private async postInTx(tx: Tx, branchId: string, userId: string, id: string, deviceId?: string) {
    // The conditional update is the guard: a second post of the same draft changes nothing and fails.
    const claimed = await tx.productionEntry.updateMany({
      where: { id, branchId, status: 'DRAFT' },
      data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
    });
    if (claimed.count === 0) {
      const e = await tx.productionEntry.findFirst({ where: { id, branchId } });
      if (!e) throw new NotFoundException('Production entry not found');
      throw new ConflictException(`This entry is already ${e.status.toLowerCase()}`);
    }
    const entry = await tx.productionEntry.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const ids = [...new Set(entry.lines.map((l) => l.ingredientId))].sort();
    // Lock in a fixed order so two batches sharing an ingredient cannot deadlock.
    for (const ingredientId of ids) {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`;
    }
    const refs = { productionEntryId: id, deviceId };
    const note = `Production ${entry.entryNo}`;

    for (const l of entry.lines.filter((x) => x.role === 'INPUT')) {
      await this.stock.consumeStock(tx, branchId, l.ingredientId, l.quantity, {
        type: 'PRODUCTION_USE',
        note,
        userId,
        allowNegative: false, // never below zero; a manager fixes the count with an adjustment first
        refs,
      });
    }
    for (const l of entry.lines.filter((x) => x.role === 'OUTPUT')) {
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: l.ingredientId } });
      const batch = await tx.stockBatch.create({
        data: {
          branchId,
          ingredientId: l.ingredientId,
          batchNumber: entry.batchRef || entry.entryNo,
          quantityReceived: l.quantity,
          quantityRemaining: l.quantity,
          unitCost: 0, // no cost is invented for produced stock
        },
      });
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: l.ingredientId,
          batchId: batch.id,
          type: 'PRODUCTION',
          quantity: l.quantity,
          note,
          createdById: userId,
          ...refs,
        },
      });
      await tx.ingredient.update({
        where: { id: l.ingredientId },
        data: { currentStock: Dec(ing.currentStock).plus(l.quantity) },
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
    await this.prisma.$transaction((tx) => this.voidInTx(tx, branchId, userId, id, reason));
    return this.get(branchId, id);
  }

  private async voidInTx(tx: Tx, branchId: string, userId: string, id: string, reason: string) {
    const claimed = await tx.productionEntry.updateMany({
      where: { id, branchId, status: 'POSTED' },
      data: { status: 'VOIDED', voidedById: userId, voidedAt: new Date(), voidReason: reason },
    });
    if (claimed.count === 0) {
      const e = await tx.productionEntry.findFirst({ where: { id, branchId } });
      if (!e) throw new NotFoundException('Production entry not found');
      throw new BadRequestException(`Only a posted entry can be reversed (this one is ${e.status.toLowerCase()})`);
    }
    const entry = await tx.productionEntry.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const ids = [...new Set(entry.lines.map((l) => l.ingredientId))].sort();
    for (const ingredientId of ids) {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`;
    }
    const moves = await tx.stockMovement.findMany({
      where: { productionEntryId: id, branchId, type: { in: ['PRODUCTION', 'PRODUCTION_USE'] } },
    });
    const note = `Reversal of ${entry.entryNo}: ${reason}`;

    // Finished stock first: if any of it was already sold or wasted the reversal must stop, because
    // taking it back would push the product below what is physically on hand.
    for (const m of moves.filter((x) => x.type === 'PRODUCTION')) {
      const batch = m.batchId ? await tx.stockBatch.findUnique({ where: { id: m.batchId } }) : null;
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: m.ingredientId } });
      if (!batch || Dec(batch.quantityRemaining).lt(m.quantity)) {
        throw new BadRequestException(
          `Cannot reverse: some of the ${ing.name} from this batch has already been sold or wasted. Record a stock adjustment instead.`,
        );
      }
      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { quantityRemaining: Dec(batch.quantityRemaining).minus(m.quantity) },
      });
      await tx.stockMovement.create({
        data: {
          branchId, ingredientId: m.ingredientId, batchId: batch.id, type: 'REVERSAL',
          quantity: Dec(m.quantity).negated(), note, createdById: userId, productionEntryId: id,
        },
      });
      await tx.ingredient.update({
        where: { id: m.ingredientId },
        data: { currentStock: Dec(ing.currentStock).minus(m.quantity) },
      });
    }
    // Raw materials go back into the batches they were drawn from.
    for (const m of moves.filter((x) => x.type === 'PRODUCTION_USE')) {
      const back = Dec(m.quantity).negated();
      const ing = await tx.ingredient.findUniqueOrThrow({ where: { id: m.ingredientId } });
      if (m.batchId) {
        const batch = await tx.stockBatch.findUnique({ where: { id: m.batchId } });
        if (batch) {
          await tx.stockBatch.update({
            where: { id: batch.id },
            data: { quantityRemaining: Dec(batch.quantityRemaining).plus(back) },
          });
        }
      }
      await tx.stockMovement.create({
        data: {
          branchId, ingredientId: m.ingredientId, batchId: m.batchId, type: 'REVERSAL',
          quantity: back, note, createdById: userId, productionEntryId: id,
        },
      });
      await tx.ingredient.update({
        where: { id: m.ingredientId },
        data: { currentStock: Dec(ing.currentStock).plus(back) },
      });
    }
    await this.audit.record({
      userId, action: 'production.void', entity: 'ProductionEntry', entityId: id,
      metadata: { entryNo: entry.entryNo, reason },
    });
  }

  /** Reverse the posted entry and post a replacement in one transaction, linked both ways. */
  async correct(branchId: string, userId: string, id: string, dto: CorrectProductionDto) {
    const { reason, ...rest } = dto;
    const newId = await this.prisma.$transaction(async (tx) => {
      await this.voidInTx(tx, branchId, userId, id, `Corrected: ${reason}`);
      const created = await this.createInTx(tx, branchId, userId, rest, id);
      await this.postInTx(tx, branchId, userId, created.id, dto.deviceId);
      return created.id;
    });
    return this.get(branchId, newId);
  }

  // ---- read ------------------------------------------------------------------------------------

  async get(branchId: string, id: string) {
    const e = await this.prisma.productionEntry.findFirst({ where: { id, branchId }, include: ENTRY_INCLUDE });
    if (!e) throw new NotFoundException('Production entry not found');
    return e;
  }

  private where(branchId: string, f: ProductionFilters): Prisma.ProductionEntryWhereInput {
    return {
      branchId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.location ? { location: f.location } : {}),
      ...(f.shift ? { shift: f.shift } : {}),
      ...(f.employeeId ? { responsibleId: f.employeeId } : {}),
      ...(f.from || f.to ? { producedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
      ...(f.productId ? { lines: { some: { ingredientId: f.productId, role: 'OUTPUT' } } } : {}),
    };
  }

  async list(branchId: string, f: ProductionFilters, take = 100) {
    const rows = await this.prisma.productionEntry.findMany({
      where: this.where(branchId, f),
      include: ENTRY_INCLUDE,
      orderBy: { producedAt: 'desc' },
      take: Math.min(take, 500),
    });
    const people = await this.people(rows.flatMap((r) => [r.responsibleId, r.createdById, r.postedById, r.voidedById]));
    return rows.map((r) => ({
      ...r,
      responsibleName: r.responsibleId ? people.get(r.responsibleId) ?? null : null,
      createdByName: people.get(r.createdById) ?? null,
    }));
  }

  private async people(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** What was produced and consumed over a period, posted entries only, grouped for the daily report. */
  async report(branchId: string, f: ProductionFilters) {
    const entries = await this.list(branchId, { ...f, status: 'POSTED' }, 500);
    const produced = new Map<string, { ingredientId: string; name: string; unit: string; quantity: Prisma.Decimal }>();
    const used = new Map<string, { ingredientId: string; name: string; unit: string; quantity: Prisma.Decimal }>();
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
    const fmt = (m: Map<string, { ingredientId: string; name: string; unit: string; quantity: Prisma.Decimal }>) =>
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
        e.entryNo, e.producedAt, e.status, e.shift, e.location, e.batchRef, e.responsibleName,
        l.role === 'OUTPUT' ? 'Produced' : 'Used', l.ingredient.name,
        l.enteredQuantity.toString(), l.enteredUnit, l.quantity.toString(), l.ingredient.unit,
        e.voidReason, e.correctsEntry?.entryNo,
      ]),
    );
    return toCsv(
      ['Entry', 'Produced at', 'Status', 'Shift', 'Location', 'Batch', 'Responsible', 'Line', 'Item',
        'Entered qty', 'Entered unit', 'Stock qty', 'Stock unit', 'Void reason', 'Corrects'],
      rows,
    );
  }

  /** Items usually used for a product last time. Hints only: the cook still types the real quantities. */
  async suggestInputs(branchId: string, productId: string) {
    const last = await this.prisma.productionEntry.findFirst({
      where: { branchId, status: 'POSTED', lines: { some: { ingredientId: productId, role: 'OUTPUT' } } },
      orderBy: { producedAt: 'desc' },
      include: { lines: { where: { role: 'INPUT' }, include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
    });
    return (last?.lines ?? []).map((l) => ({
      ingredientId: l.ingredientId,
      name: l.ingredient.name,
      unit: l.enteredUnit,
      lastQuantity: l.enteredQuantity.toString(),
    }));
  }
}
