import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { localDate, zonedRange } from '../../common/time';
import { toCsv } from '../reports/csv';

const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const s = (v: Prisma.Decimal | null | undefined, dp?: number) =>
  v == null
    ? null
    : dp === undefined
      ? v.toString()
      : v.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP).toString();

export interface ReportFilters {
  from?: string; // local date YYYY-MM-DD, inclusive
  to?: string;
  productId?: string;
  batchRef?: string;
  po?: string; // PO number or supplier
  locationId?: string;
  recipeId?: string;
}

type Entry = Prisma.ProductionEntryGetPayload<{
  include: {
    lines: { include: { ingredient: { select: { name: true; unit: true } } } };
    costs: true;
  };
}>;

// Everything here reads the figures frozen on POSTED vouchers (line rates, line costs, allocated costs, the recipe
// snapshot). Draft and reversed vouchers never appear; a corrected voucher shows once, as its replacement. Days are
// cut in the restaurant's timezone (Asia/Kolkata unless the restaurant set another).
@Injectable()
export class ProductionReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
  ) {}

  private async load(branchId: string, f: ReportFilters) {
    const tz = await this.time.tzForBranch(branchId);
    const range =
      f.from || f.to
        ? zonedRange(f.from ?? f.to!, f.to ?? f.from!, tz)
        : undefined;
    const where: Prisma.ProductionEntryWhereInput = {
      branchId,
      status: 'POSTED',
      ...(range ? { producedAt: range } : {}),
      ...(f.batchRef
        ? { batchRef: { contains: f.batchRef, mode: 'insensitive' } }
        : {}),
      ...(f.po
        ? {
            OR: [
              { sourcePoNumber: { contains: f.po, mode: 'insensitive' } },
              { sourceSupplier: { contains: f.po, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(f.recipeId ? { recipeId: f.recipeId } : {}),
      AND: [
        ...(f.productId
          ? [
              {
                lines: {
                  some: { ingredientId: f.productId, role: 'OUTPUT' as const },
                },
              },
            ]
          : []),
        ...(f.locationId
          ? [{ lines: { some: { locationId: f.locationId } } }]
          : []),
      ],
    };
    const entries = await this.prisma.productionEntry.findMany({
      where,
      orderBy: [{ producedAt: 'asc' }, { entryNo: 'asc' }],
      take: 2000,
      include: {
        lines: {
          include: { ingredient: { select: { name: true, unit: true } } },
          orderBy: { id: 'asc' },
        },
        costs: true,
      },
    });
    return { tz, entries };
  }

  private voucher(e: Entry, tz: string) {
    const snap = (e.recipeSnapshot ?? null) as {
      baseOutputQty?: string;
      lines?: { ingredientId: string; quantity: string; unit: string }[];
    } | null;
    const inputs = e.lines
      .filter((l) => l.role === 'INPUT')
      .map((l) => {
        const exp = l.expectedQuantity;
        return {
          ingredientId: l.ingredientId,
          name: l.ingredient.name,
          unit: l.ingredient.unit,
          enteredQuantity: `${l.enteredQuantity.toString()} ${l.enteredUnit}`,
          quantity: s(l.quantity)!,
          rate: s(l.unitRate, 4),
          cost: s(l.lineCost, 2),
          expected: s(exp),
          variance: exp ? s(l.quantity.minus(exp)) : null,
          variancePercent:
            exp && exp.gt(0)
              ? s(l.quantity.minus(exp).div(exp).mul(100), 1)
              : null,
          location: l.locationName,
          lot: l.lotNumber,
          directTo: l.directToIngredientId
            ? (e.lines.find(
                (x) =>
                  x.role === 'OUTPUT' &&
                  x.ingredientId === l.directToIngredientId,
              )?.ingredient.name ?? null)
            : null,
        };
      });
    const outputs = e.lines
      .filter((l) => l.role === 'OUTPUT')
      .map((l) => {
        const total = l.quantity.plus(l.rejectedQuantity);
        return {
          ingredientId: l.ingredientId,
          name: l.ingredient.name,
          unit: l.ingredient.unit,
          good: s(l.quantity)!,
          rejected: s(l.rejectedQuantity)!,
          rejectRate: total.gt(0)
            ? s(l.rejectedQuantity.div(total).mul(100), 1)
            : '0',
          expected: s(l.expectedQuantity),
          yieldPercent:
            l.expectedQuantity && l.expectedQuantity.gt(0)
              ? s(l.quantity.div(l.expectedQuantity).mul(100), 1)
              : null,
          percent: s(l.allocationPercent, 3),
          allocatedCost: s(l.allocatedCost, 2),
          unitCost: s(l.goodUnitCost, 4),
          location: l.locationName,
          lot: l.lotNumber,
        };
      });
    return {
      id: e.id,
      entryNo: e.entryNo,
      producedAt: e.producedAt,
      date: localDate(e.producedAt, tz),
      batchRef: e.batchRef,
      notes: e.notes,
      sourcePo: e.sourcePoNumber,
      sourceSupplier: e.sourceSupplier,
      recipe: e.recipeName
        ? {
            name: e.recipeName,
            kind: e.recipeKind,
            baseOutputQty: snap?.baseOutputQty ?? null,
          }
        : null,
      costed: e.costed,
      ingredientCost: s(e.ingredientCost, 2),
      additionalCost: s(e.additionalCost, 2),
      totalCost: s(e.totalCost, 2),
      allocationMethod: e.allocationMethod,
      additionalCosts: e.costs.map((c) => ({
        category: c.category,
        description: c.description,
        amount: s(c.amount, 2),
        included: c.included,
      })),
      quality: e.qualityResult
        ? {
            result: e.qualityResult,
            grade: e.qualityGrade,
            notes: e.qualityNotes,
          }
        : null,
      inputs,
      outputs,
    };
  }

  /** One block per local date, vouchers inside, plus per-day and overall totals that add up from the vouchers. */
  async daily(branchId: string, f: ReportFilters) {
    const { tz, entries } = await this.load(branchId, f);
    const vouchers = entries.map((e) => this.voucher(e, tz));
    const days = new Map<string, typeof vouchers>();
    for (const v of vouchers)
      days.set(v.date, [...(days.get(v.date) ?? []), v]);
    const sum = (list: typeof vouchers) => {
      const used = new Map<
        string,
        {
          name: string;
          unit: string;
          quantity: Prisma.Decimal;
          cost: Prisma.Decimal;
        }
      >();
      const made = new Map<
        string,
        {
          name: string;
          unit: string;
          good: Prisma.Decimal;
          rejected: Prisma.Decimal;
          cost: Prisma.Decimal;
        }
      >();
      let total = Dec(0);
      for (const v of list) {
        total = total.plus(v.totalCost ?? 0);
        for (const i of v.inputs) {
          const c = used.get(i.ingredientId) ?? {
            name: i.name,
            unit: i.unit,
            quantity: Dec(0),
            cost: Dec(0),
          };
          used.set(i.ingredientId, {
            ...c,
            quantity: c.quantity.plus(i.quantity),
            cost: c.cost.plus(i.cost ?? 0),
          });
        }
        for (const o of v.outputs) {
          const c = made.get(o.ingredientId) ?? {
            name: o.name,
            unit: o.unit,
            good: Dec(0),
            rejected: Dec(0),
            cost: Dec(0),
          };
          made.set(o.ingredientId, {
            ...c,
            good: c.good.plus(o.good),
            rejected: c.rejected.plus(o.rejected),
            cost: c.cost.plus(o.allocatedCost ?? 0),
          });
        }
      }
      return {
        vouchers: list.length,
        totalCost: total.toString(),
        consumed: [...used.entries()].map(([id, c]) => ({
          ingredientId: id,
          name: c.name,
          unit: c.unit,
          quantity: c.quantity.toString(),
          cost: c.cost.toFixed(2),
        })),
        produced: [...made.entries()].map(([id, c]) => ({
          ingredientId: id,
          name: c.name,
          unit: c.unit,
          good: c.good.toString(),
          rejected: c.rejected.toString(),
          allocatedCost: c.cost.toFixed(2),
          unitCost: c.good.gt(0)
            ? c.cost.div(c.good).toDecimalPlaces(4).toString()
            : null,
        })),
      };
    };
    return {
      timezone: tz,
      note: 'Posted vouchers only, from the figures frozen when each was posted. Cost per unit = allocated cost / good (saleable) quantity.',
      days: [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, list]) => ({ date, ...sum(list), vouchers: list })),
      totals: sum(vouchers),
    };
  }

  async dailyCsv(branchId: string, f: ReportFilters) {
    const { days } = await this.daily(branchId, f);
    const rows: (string | null)[][] = [];
    for (const d of days)
      for (const v of d.vouchers) {
        const head = [
          d.date,
          v.entryNo,
          v.batchRef,
          v.sourcePo,
          v.sourceSupplier,
          v.recipe?.name ?? '(no recipe)',
        ];
        for (const i of v.inputs)
          rows.push([
            ...head,
            'Consumed',
            i.name,
            i.unit,
            i.quantity,
            i.expected,
            i.variance,
            i.variancePercent,
            '',
            i.rate,
            i.cost,
            '',
            i.location,
            i.lot,
            v.ingredientCost,
            v.additionalCost,
            v.totalCost,
            '',
          ]);
        for (const o of v.outputs)
          rows.push([
            ...head,
            'Produced',
            o.name,
            o.unit,
            o.good,
            o.expected,
            '',
            o.yieldPercent,
            o.rejected,
            '',
            o.allocatedCost,
            o.unitCost,
            o.location,
            o.lot,
            v.ingredientCost,
            v.additionalCost,
            v.totalCost,
            v.quality?.result ?? '',
          ]);
      }
    return toCsv(
      [
        'Date',
        'Voucher',
        'Batch',
        'PO',
        'Supplier',
        'Recipe',
        'Direction',
        'Item',
        'Unit',
        'Quantity (consumed / good produced)',
        'Expected',
        'Variance',
        'Variance % / Yield %',
        'Rejected',
        'Rate',
        'Cost (consumed) / Allocated cost (produced)',
        'Cost per good unit',
        'Location',
        'Lot',
        'Batch ingredient cost',
        'Batch additional cost (net)',
        'Batch total cost',
        'Quality',
      ],
      rows,
    );
  }

  /**
   * Batch-to-batch comparison per finished product: ingredient use per 100 good units, cost per good unit, yield,
   * reject rate. It reports; it never calls a lower or higher number "better" (quality notes sit beside it).
   */
  async analysis(branchId: string, f: ReportFilters) {
    const { tz, entries } = await this.load(branchId, f);
    const products = new Map<
      string,
      {
        productId: string;
        name: string;
        unit: string;
        batches: unknown[];
        days: Map<string, { cost: Prisma.Decimal; good: Prisma.Decimal }>;
      }
    >();
    for (const e of entries) {
      const v = this.voucher(e, tz);
      for (const o of e.lines.filter((l) => l.role === 'OUTPUT')) {
        if (f.productId && o.ingredientId !== f.productId) continue;
        const p = products.get(o.ingredientId) ?? {
          productId: o.ingredientId,
          name: o.ingredient.name,
          unit: o.ingredient.unit,
          batches: [] as unknown[],
          days: new Map<
            string,
            { cost: Prisma.Decimal; good: Prisma.Decimal }
          >(),
        };
        const good = o.quantity;
        const total = good.plus(o.rejectedQuantity);
        // Ingredient use is attributed to this product by its share of the batch (100% when it is the only product).
        const share = o.allocationPercent
          ? o.allocationPercent.div(100)
          : Dec(1);
        const ingredients = e.lines
          .filter((l) => l.role === 'INPUT')
          .filter(
            (l) =>
              !l.directToIngredientId ||
              l.directToIngredientId === o.ingredientId,
          )
          .map((l) => {
            const mine = l.directToIngredientId
              ? l.quantity
              : l.quantity.mul(share);
            const exp = l.expectedQuantity
              ? l.directToIngredientId
                ? l.expectedQuantity
                : l.expectedQuantity.mul(share)
              : null;
            const planned = o.expectedQuantity;
            return {
              name: l.ingredient.name,
              unit: l.ingredient.unit,
              actual: s(mine, 3),
              expected: s(exp, 3),
              variancePercent:
                exp && exp.gt(0)
                  ? s(mine.minus(exp).div(exp).mul(100), 1)
                  : null,
              per100Good: good.gt(0) ? s(mine.div(good).mul(100), 3) : null,
              expectedPer100:
                exp && planned && planned.gt(0)
                  ? s(exp.div(planned).mul(100), 3)
                  : null,
            };
          });
        const day = p.days.get(v.date) ?? { cost: Dec(0), good: Dec(0) };
        p.days.set(v.date, {
          cost: day.cost.plus(o.allocatedCost ?? 0),
          good: day.good.plus(good),
        });
        p.batches.push({
          voucherId: e.id,
          entryNo: e.entryNo,
          date: v.date,
          batchRef: e.batchRef,
          recipe: e.recipeName,
          good: s(good),
          rejected: s(o.rejectedQuantity),
          rejectRate: total.gt(0)
            ? s(o.rejectedQuantity.div(total).mul(100), 1)
            : '0',
          expected: s(o.expectedQuantity),
          yieldPercent:
            o.expectedQuantity && o.expectedQuantity.gt(0)
              ? s(good.div(o.expectedQuantity).mul(100), 1)
              : null,
          allocatedCost: s(o.allocatedCost, 2),
          unitCost: s(o.goodUnitCost, 4),
          quality: e.qualityResult
            ? `${e.qualityResult}${e.qualityGrade ? ` ${e.qualityGrade}` : ''}${e.qualityNotes ? `: ${e.qualityNotes}` : ''}`
            : null,
          ingredients,
        });
        products.set(o.ingredientId, p);
      }
    }
    return {
      note: 'Compare batches using yield, cost per good unit, reject rate and the quality note together. A lower ingredient quantity is not an improvement by itself.',
      products: [...products.values()].map((p) => ({
        productId: p.productId,
        name: p.name,
        unit: p.unit,
        batches: p.batches,
        dailyCost: [...p.days.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, d]) => ({
            date,
            good: d.good.toString(),
            allocatedCost: d.cost.toFixed(2),
            weightedUnitCost: d.good.gt(0)
              ? d.cost.div(d.good).toDecimalPlaces(4).toString()
              : null,
          })),
      })),
    };
  }

  async analysisCsv(branchId: string, f: ReportFilters) {
    const { products } = await this.analysis(branchId, f);
    const rows: (string | null)[][] = [];
    for (const p of products)
      for (const b of p.batches as {
        entryNo: string;
        date: string;
        batchRef: string | null;
        good: string;
        rejected: string;
        rejectRate: string;
        yieldPercent: string | null;
        unitCost: string | null;
        allocatedCost: string | null;
        ingredients: {
          name: string;
          unit: string;
          actual: string | null;
          expected: string | null;
          variancePercent: string | null;
          per100Good: string | null;
          expectedPer100: string | null;
        }[];
      }[])
        for (const i of b.ingredients)
          rows.push([
            p.name,
            b.date,
            b.entryNo,
            b.batchRef,
            b.good,
            b.rejected,
            b.rejectRate,
            b.yieldPercent,
            b.allocatedCost,
            b.unitCost,
            i.name,
            i.unit,
            i.actual,
            i.expected,
            i.variancePercent,
            i.per100Good,
            i.expectedPer100,
          ]);
    return toCsv(
      [
        'Product',
        'Date',
        'Voucher',
        'Batch',
        'Good qty',
        'Rejected',
        'Reject %',
        'Yield % vs plan',
        'Allocated cost',
        'Cost per good unit',
        'Ingredient',
        'Unit',
        'Actual used',
        'Expected',
        'Variance %',
        'Used per 100 good',
        'Expected per 100 planned',
      ],
      rows,
    );
  }

  /**
   * POS: the latest posted production cost of each sold item next to its selling price. "Today" is the restaurant's
   * local day; with no batch today the latest older cost is returned with its own date and `isToday: false`, never
   * labelled as today's. cost per portion = cost per stock unit x the stock quantity one sale uses.
   */
  async menuCosts(branchId: string) {
    const tz = await this.time.tzForBranch(branchId);
    const today = localDate(new Date(), tz);
    const items = await this.prisma.menuItem.findMany({
      where: { branchId, stockIngredientId: { not: null } },
      select: {
        id: true,
        name: true,
        price: true,
        stockIngredientId: true,
        stockQuantityPerSale: true,
      },
    });
    if (!items.length) return { today, timezone: tz, items: [] };
    const lines = await this.prisma.productionLine.findMany({
      where: {
        role: 'OUTPUT',
        allocatedCost: { not: null },
        ingredientId: {
          in: [...new Set(items.map((i) => i.stockIngredientId!))],
        },
        entry: { branchId, status: 'POSTED', costed: true },
      },
      select: {
        ingredientId: true,
        quantity: true,
        allocatedCost: true,
        entry: { select: { producedAt: true, entryNo: true } },
      },
      orderBy: { entry: { producedAt: 'desc' } },
      take: 5000,
    });
    const out: Record<string, unknown>[] = [];
    for (const m of items) {
      const mine = lines.filter((l) => l.ingredientId === m.stockIngredientId);
      if (!mine.length) continue;
      const latestDay = localDate(mine[0].entry.producedAt, tz);
      const sameDay = mine.filter(
        (l) => localDate(l.entry.producedAt, tz) === latestDay,
      );
      const cost = sameDay.reduce((a, l) => a.plus(l.allocatedCost!), Dec(0));
      const good = sameDay.reduce((a, l) => a.plus(l.quantity), Dec(0));
      if (good.lte(0)) continue;
      const perStock = cost.div(good);
      const perPortion = perStock
        .mul(m.stockQuantityPerSale)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      out.push({
        menuItemId: m.id,
        name: m.name,
        price: Dec(m.price).toFixed(2),
        costPerPortion: perPortion.toFixed(2),
        costDate: latestDay,
        isToday: latestDay === today,
        batches: sameDay.length,
        indicativeDifference: Dec(m.price).minus(perPortion).toFixed(2),
      });
    }
    return { today, timezone: tz, items: out };
  }
}
