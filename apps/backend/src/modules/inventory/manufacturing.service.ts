import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProductionEntryDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { toCsv } from '../reports/csv';
import { costBatch, priceMetrics } from './manufacturing-calc';
import { toBaseQuantity } from './units';

const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal | null | undefined, dp = 2) =>
  v == null
    ? null
    : Dec(v).toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP).toFixed(dp);

// Manufacturing (costed production): the settings switch, the server-side preview shown before posting, and the reports.
// Reports read only what was frozen when batches were posted, never today's recipe or ingredient prices.
@Injectable()
export class ManufacturingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- settings -------------------------------------------------------------------------------

  async settings(restaurantId: string, branchId: string) {
    const r = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { manufacturingEnabled: true, requireTableSession: true },
    });
    const latest = r.manufacturingEnabled
      ? await this.prisma.productionEntry.findFirst({
          where: { branchId, status: 'POSTED', costed: true },
          orderBy: { producedAt: 'desc' },
          include: {
            lines: {
              where: { role: 'OUTPUT' },
              include: { ingredient: { select: { name: true, unit: true } } },
            },
          },
        })
      : null;
    return {
      enabled: r.manufacturingEnabled,
      requireTableSession: r.requireTableSession,
      latest: latest
        ? {
            entryNo: latest.entryNo,
            producedAt: latest.producedAt,
            item: latest.lines[0]?.ingredient.name ?? null,
            unit: latest.lines[0]?.ingredient.unit ?? null,
            unitCost: money(latest.unitCost, 4),
            quantity: latest.lines[0]?.quantity.toString() ?? null,
          }
        : null,
    };
  }

  /** Turning it off keeps every record; it only hides the entry points and refuses new costed batches. */
  async setEnabled(
    restaurantId: string,
    v: { enabled?: boolean; requireTableSession?: boolean },
  ) {
    const r = await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        ...(v.enabled !== undefined ? { manufacturingEnabled: v.enabled } : {}),
        ...(v.requireTableSession !== undefined
          ? { requireTableSession: v.requireTableSession }
          : {}),
      },
      select: { manufacturingEnabled: true, requireTableSession: true },
    });
    return {
      enabled: r.manufacturingEnabled,
      requireTableSession: r.requireTableSession,
    };
  }

  // ---- preview (writes nothing; recomputed from quantities and rates on the server) -----------------

  async preview(
    branchId: string,
    dto: Pick<ProductionEntryDto, 'inputs' | 'outputs' | 'costing'>,
  ) {
    const outputs = dto.outputs;
    if (outputs.length !== 1)
      throw new BadRequestException(
        'A costed batch makes exactly one finished product',
      );
    const out = await this.prisma.ingredient.findFirst({
      where: { id: outputs[0].ingredientId, branchId },
    });
    if (!out) throw new NotFoundException('Finished product not found');
    const outQty = toBaseQuantity(
      outputs[0].quantity,
      outputs[0].unit,
      out.unit,
      out.conversions,
      out.name,
    );

    const ids = [...new Set(dto.inputs.map((i) => i.ingredientId))];
    const ings = new Map(
      (
        await this.prisma.ingredient.findMany({
          where: { id: { in: ids }, branchId },
        })
      ).map((i) => [i.id, i]),
    );
    const rows = dto.inputs.map((l) => {
      const ing = ings.get(l.ingredientId);
      if (!ing) throw new NotFoundException('An ingredient was not found');
      const qty = toBaseQuantity(
        l.quantity,
        l.unit,
        ing.unit,
        ing.conversions,
        ing.name,
      );
      const typed = l.rate !== undefined && l.rate !== '' ? Dec(l.rate) : null;
      const rate =
        typed ?? (Dec(ing.costPerUnit).gt(0) ? Dec(ing.costPerUnit) : null);
      return {
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        quantity: qty,
        rate,
        rateSource: typed ? 'typed' : rate ? 'average cost' : 'missing',
        onHand: Dec(ing.currentStock),
      };
    });
    const missing = rows.filter((r) => r.rate === null).map((r) => r.name);
    const shortages = rows
      .filter((r) => r.onHand.lt(r.quantity))
      .map((r) => r.name);
    let calc: ReturnType<typeof costBatch> | null = null;
    if (missing.length === 0) {
      calc = costBatch({
        lines: rows.map((r) => ({
          key: r.ingredientId,
          name: r.name,
          quantity: r.quantity,
          rate: r.rate!,
        })),
        costs: (dto.costing?.costs ?? []).map((c) => ({ ...c })),
        outputQty: outQty,
      });
    }

    // The menu item this finished product is sold as (linked under Menu > Stock when sold).
    const items = await this.prisma.menuItem.findMany({
      where: { branchId, stockIngredientId: out.id },
      select: { id: true, name: true, price: true },
    });
    const pick = dto.costing?.menuPrice
      ? items.find((m) => m.id === dto.costing!.menuPrice!.menuItemId)
      : items[0];
    const currentPrice = pick ? Dec(pick.price) : null;
    const proposed = dto.costing?.menuPrice
      ? Dec(dto.costing.menuPrice.newPrice)
      : null;
    return {
      finished: { name: out.name, unit: out.unit, quantity: outQty.toString() },
      lines: rows.map((r, i) => ({
        ingredientId: r.ingredientId,
        name: r.name,
        unit: r.unit,
        quantity: r.quantity.toString(),
        rate: r.rate ? r.rate.toString() : null,
        rateSource: r.rateSource,
        lineCost: calc ? calc.lines[i].lineCost.toString() : null,
      })),
      missingRates: missing,
      shortages,
      costs: calc
        ? calc.costs.map((c) => ({
            category: c.category,
            description: c.description,
            amount: c.amount.toString(),
            included: c.included,
          }))
        : [],
      ingredientCost: calc?.ingredientCost.toString() ?? null,
      additionalCost: calc?.additionalCost.toString() ?? null,
      totalCost: calc?.totalCost.toString() ?? null,
      unitCost: calc?.unitCost.toString() ?? null,
      menuItems: items.map((m) => ({
        id: m.id,
        name: m.name,
        price: Dec(m.price).toFixed(2),
      })),
      menuItem: pick ? { id: pick.id, name: pick.name } : null,
      currentPrice: currentPrice ? currentPrice.toFixed(2) : null,
      currentPriceMetrics:
        calc && currentPrice
          ? serial(priceMetrics(currentPrice, calc.unitCost))
          : null,
      proposedPrice: proposed ? proposed.toFixed(2) : null,
      proposedPriceMetrics:
        calc && proposed && proposed.gt(0)
          ? serial(priceMetrics(proposed, calc.unitCost))
          : null,
      pricesIncludeTax: true,
      canPost: !!calc && shortages.length === 0,
    };
  }

  /** Recipe quantities for a finished product's menu item, scaled to the quantity being made, as a starting point only. */
  async prefill(branchId: string, ingredientId: string, quantity: string) {
    const q = Dec(quantity || '1');
    const item = await this.prisma.menuItem.findFirst({
      where: { branchId, stockIngredientId: ingredientId },
      include: {
        recipeLines: {
          include: {
            ingredient: { select: { id: true, name: true, unit: true } },
          },
        },
      },
    });
    const lines = (item?.recipeLines ?? []).map((r) => ({
      ingredientId: r.ingredientId,
      name: r.ingredient.name,
      unit: r.unit ?? r.ingredient.unit,
      quantity: Dec(r.quantity).mul(q).toDecimalPlaces(3).toString(),
    }));
    return { source: lines.length ? `recipe of ${item!.name}` : null, lines };
  }

  // ---- reports --------------------------------------------------------------------------------------

  async report(
    branchId: string,
    f: { from?: Date; to?: Date; itemId?: string; status?: string },
  ) {
    const where: Prisma.ProductionEntryWhereInput = {
      branchId,
      costed: true,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.from || f.to
        ? {
            producedAt: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {}),
      ...(f.itemId
        ? { lines: { some: { ingredientId: f.itemId, role: 'OUTPUT' } } }
        : {}),
    };
    const entries = await this.prisma.productionEntry.findMany({
      where,
      orderBy: { producedAt: 'desc' },
      take: 1000,
      include: {
        lines: {
          include: {
            ingredient: { select: { id: true, name: true, unit: true } },
          },
        },
        costs: true,
        correctedBy: { select: { entryNo: true } },
        correctsEntry: { select: { entryNo: true } },
      },
    });
    const posted = entries.filter((e) => e.status === 'POSTED');
    const day = (d: Date) => d.toISOString().slice(0, 10);

    const byDayMap = new Map<
      string,
      { date: string; batches: number; totalCost: Prisma.Decimal }
    >();
    const produced = new Map<
      string,
      {
        itemId: string;
        name: string;
        unit: string;
        quantity: Prisma.Decimal;
        totalCost: Prisma.Decimal;
        batches: number;
      }
    >();
    const consumed = new Map<
      string,
      {
        date: string;
        itemId: string;
        name: string;
        unit: string;
        quantity: Prisma.Decimal;
        cost: Prisma.Decimal;
      }
    >();
    const catMap = new Map<string, Prisma.Decimal>();
    for (const e of posted) {
      const d = day(e.producedAt);
      const cur = byDayMap.get(d) ?? { date: d, batches: 0, totalCost: Dec(0) };
      byDayMap.set(d, {
        date: d,
        batches: cur.batches + 1,
        totalCost: cur.totalCost.plus(e.totalCost ?? 0),
      });
      for (const l of e.lines) {
        if (l.role === 'OUTPUT') {
          const c = produced.get(l.ingredientId) ?? {
            itemId: l.ingredientId,
            name: l.ingredient.name,
            unit: l.ingredient.unit,
            quantity: Dec(0),
            totalCost: Dec(0),
            batches: 0,
          };
          produced.set(l.ingredientId, {
            ...c,
            quantity: c.quantity.plus(l.quantity),
            totalCost: c.totalCost.plus(e.totalCost ?? 0),
            batches: c.batches + 1,
          });
        } else {
          const k = `${d}|${l.ingredientId}`;
          const c = consumed.get(k) ?? {
            date: d,
            itemId: l.ingredientId,
            name: l.ingredient.name,
            unit: l.ingredient.unit,
            quantity: Dec(0),
            cost: Dec(0),
          };
          consumed.set(k, {
            ...c,
            quantity: c.quantity.plus(l.quantity),
            cost: c.cost.plus(l.lineCost ?? 0),
          });
        }
      }
      for (const c of e.costs.filter((x) => x.included))
        catMap.set(
          c.category,
          (catMap.get(c.category) ?? Dec(0)).plus(c.amount),
        );
    }
    const prices = await this.prisma.menuPriceChange.findMany({
      where: {
        branchId,
        source: 'STOCK_JOURNAL',
        ...(f.from || f.to
          ? {
              changedAt: {
                ...(f.from ? { gte: f.from } : {}),
                ...(f.to ? { lte: f.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { changedAt: 'desc' },
      take: 200,
    });
    const [mi, us, pe] = await Promise.all([
      this.prisma.menuItem.findMany({
        where: { id: { in: [...new Set(prices.map((p) => p.menuItemId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(prices.map((p) => p.changedById))] } },
        select: { id: true, name: true },
      }),
      this.prisma.productionEntry.findMany({
        where: {
          id: {
            in: prices
              .map((p) => p.productionEntryId)
              .filter((x): x is string => !!x),
          },
        },
        select: { id: true, entryNo: true },
      }),
    ]);
    // A batch's own price change, looked up by id so it is found even outside the report's date window or row cap.
    const entryPrices = await this.prisma.menuPriceChange.findMany({
      where: {
        branchId,
        id: {
          in: entries
            .map((e) => e.priceChangeId)
            .filter((x): x is string => !!x),
        },
      },
    });
    const statusCounts = ['DRAFT', 'POSTED', 'VOIDED'].map((s) => ({
      status: s,
      count: entries.filter((e) => e.status === s).length,
    }));
    return {
      note: 'Costs are the figures frozen when each batch was posted. Today’s recipe and ingredient prices are not used.',
      batchesByDay: [...byDayMap.values()]
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((d) => ({ ...d, totalCost: money(d.totalCost) })),
      produced: [...produced.values()].map((p) => ({
        ...p,
        quantity: p.quantity.toString(),
        totalCost: money(p.totalCost),
        avgUnitCost: p.quantity.gt(0)
          ? money(p.totalCost.div(p.quantity), 4)
          : null,
      })),
      consumed: [...consumed.values()]
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((c) => ({
          ...c,
          quantity: c.quantity.toString(),
          cost: money(c.cost),
        })),
      additionalByCategory: [...catMap.entries()].map(([category, amount]) => ({
        category,
        amount: money(amount),
      })),
      batches: entries.map((e) => ({
        id: e.id,
        entryNo: e.entryNo,
        producedAt: e.producedAt,
        status: e.status,
        item: e.lines.find((l) => l.role === 'OUTPUT')?.ingredient.name ?? null,
        itemId: e.lines.find((l) => l.role === 'OUTPUT')?.ingredientId ?? null,
        unit: e.lines.find((l) => l.role === 'OUTPUT')?.ingredient.unit ?? null,
        quantity:
          e.lines.find((l) => l.role === 'OUTPUT')?.quantity.toString() ?? null,
        ingredientCost: money(e.ingredientCost),
        additionalCost: money(e.additionalCost),
        totalCost: money(e.totalCost),
        unitCost: money(e.unitCost, 4),
        corrects: e.correctsEntry?.entryNo ?? null,
        correctedBy: e.correctedBy.map((c) => c.entryNo),
        voidReason: e.voidReason,
        manufacturedOn: e.manufacturedOn,
        expiryDate: e.expiryDate,
        batchRef: e.batchRef,
        // Frozen at posting; null on batches posted before this was recorded.
        sellingPriceAtPost:
          e.sellingPriceAtPost === null ? null : money(e.sellingPriceAtPost),
        priceChange: e.priceChangeId
          ? (() => {
              const pc = entryPrices.find((p) => p.id === e.priceChangeId);
              return pc
                ? { oldPrice: money(pc.oldPrice), newPrice: money(pc.newPrice) }
                : null;
            })()
          : null,
        // "Not recorded" is its own state: no inspection never means the batch passed.
        quality: e.qualityResult
          ? {
              result: e.qualityResult,
              grade: e.qualityGrade,
              notes: e.qualityNotes,
              at: e.qualityAt,
            }
          : null,
        lines: e.lines.map((l) => ({
          role: l.role,
          item: l.ingredient.name,
          quantity: l.quantity.toString(),
          unit: l.ingredient.unit,
          rate: l.unitRate === null ? null : money(l.unitRate, 4),
          amount: l.lineCost === null ? null : money(l.lineCost),
        })),
        additionalCosts: e.costs.map((c) => ({
          category: c.category,
          description: c.description,
          amount: money(c.amount),
          included: c.included,
        })),
      })),
      statusCounts,
      priceChanges: prices.map((p) => ({
        id: p.id,
        changedAt: p.changedAt,
        item: mi.find((m) => m.id === p.menuItemId)?.name ?? '?',
        oldPrice: money(p.oldPrice),
        newPrice: money(p.newPrice),
        by: us.find((u) => u.id === p.changedById)?.name ?? null,
        entryNo: pe.find((e) => e.id === p.productionEntryId)?.entryNo ?? null,
        unitCost: money(p.unitCostAtChange, 4),
      })),
    };
  }

  async csv(
    branchId: string,
    section: string,
    f: { from?: Date; to?: Date; itemId?: string },
  ) {
    const r = await this.report(branchId, f);
    switch (section) {
      case 'days':
        return toCsv(
          ['Date', 'Batches', 'Total cost'],
          r.batchesByDay.map((d) => [d.date, d.batches, d.totalCost]),
        );
      case 'produced':
        return toCsv(
          [
            'Item',
            'Unit',
            'Quantity',
            'Batches',
            'Total cost',
            'Average cost per unit',
          ],
          r.produced.map((p) => [
            p.name,
            p.unit,
            p.quantity,
            p.batches,
            p.totalCost,
            p.avgUnitCost,
          ]),
        );
      case 'consumed':
        return toCsv(
          ['Date', 'Ingredient', 'Unit', 'Quantity', 'Cost'],
          r.consumed.map((c) => [c.date, c.name, c.unit, c.quantity, c.cost]),
        );
      case 'costs':
        return toCsv(
          ['Category', 'Amount'],
          r.additionalByCategory.map((c) => [c.category, c.amount]),
        );
      case 'prices':
        return toCsv(
          [
            'When',
            'Menu item',
            'Old price',
            'New price',
            'Changed by',
            'Batch',
            'Unit cost then',
          ],
          r.priceChanges.map((p) => [
            p.changedAt,
            p.item,
            p.oldPrice,
            p.newPrice,
            p.by,
            p.entryNo,
            p.unitCost,
          ]),
        );
      default:
        return toCsv(
          [
            'Batch',
            'Date',
            'Status',
            'Item',
            'Quantity',
            'Unit',
            'Ingredient cost',
            'Additional cost',
            'Total cost',
            'Cost per unit',
            'Menu price at posting',
            'Price changed to',
            'Batch ref',
            'Manufactured on',
            'Expiry',
            'Quality',
            'Quality grade',
            'Corrects',
            'Corrected by',
            'Void reason',
          ],
          r.batches.map((b) => [
            b.entryNo,
            b.producedAt,
            b.status,
            b.item,
            b.quantity,
            b.unit,
            b.ingredientCost,
            b.additionalCost,
            b.totalCost,
            b.unitCost,
            b.sellingPriceAtPost,
            b.priceChange?.newPrice ?? '',
            b.batchRef,
            b.manufacturedOn,
            b.expiryDate,
            b.quality ? b.quality.result : 'Not recorded',
            b.quality?.grade ?? '',
            b.corrects,
            b.correctedBy.join(' '),
            b.voidReason,
          ]),
        );
    }
  }
}

const serial = (m: ReturnType<typeof priceMetrics>) => ({
  grossProfit: m.grossProfit.toString(),
  marginPercent: m.marginPercent?.toString() ?? null,
  markupPercent: m.markupPercent?.toString() ?? null,
});
