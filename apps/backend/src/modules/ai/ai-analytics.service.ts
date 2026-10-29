import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 86_400_000;
const n = (value: unknown) => Number(value ?? 0);
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

@Injectable()
export class AiAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private since(days: number) {
    return new Date(Date.now() - days * DAY);
  }

  async demandForecast(branchId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: { branchId, status: 'PAID', createdAt: { gte: this.since(56) } },
      },
      select: {
        menuItemId: true,
        nameSnapshot: true,
        quantity: true,
        order: { select: { createdAt: true } },
      },
    });
    const byItem = new Map<string, { name: string; daily: number[] }>();
    for (const item of items) {
      const age = Math.max(
        0,
        Math.min(
          55,
          Math.floor((Date.now() - item.order.createdAt.getTime()) / DAY),
        ),
      );
      const entry = byItem.get(item.menuItemId) ?? {
        name: item.nameSnapshot,
        daily: Array(56).fill(0),
      };
      entry.daily[55 - age] += item.quantity;
      byItem.set(item.menuItemId, entry);
    }
    const forecasts = [...byItem.entries()].map(([menuItemId, entry]) => {
      const recent = entry.daily.slice(-14).reduce((a, b) => a + b, 0) / 14;
      const previous =
        entry.daily.slice(-28, -14).reduce((a, b) => a + b, 0) / 14;
      const daily = recent * 0.7 + previous * 0.3;
      return {
        menuItemId,
        name: entry.name,
        predictedNext7Days: round(daily * 7),
        trendPercent: previous
          ? round(((recent - previous) / previous) * 100)
          : null,
        confidence:
          items.length >= 100 ? 'HIGH' : items.length >= 30 ? 'MEDIUM' : 'LOW',
      };
    });
    return {
      generatedAt: new Date(),
      method: 'weighted-moving-average-56d',
      forecasts: forecasts.sort(
        (a, b) => b.predictedNext7Days - a.predictedNext7Days,
      ),
    };
  }

  async inventoryForecast(branchId: string) {
    const demand = await this.demandForecast(branchId);
    const ingredients = await this.prisma.ingredient.findMany({
      where: { branchId, isActive: true },
      include: {
        recipeLines: { include: { menuItem: { select: { id: true } } } },
      },
    });
    const itemDemand = new Map(
      demand.forecasts.map((f) => [f.menuItemId, f.predictedNext7Days]),
    );
    return {
      generatedAt: new Date(),
      ingredients: ingredients
        .map((ingredient) => {
          const weeklyUse = ingredient.recipeLines.reduce(
            (sum, line) =>
              sum + n(line.quantity) * (itemDemand.get(line.menuItem.id) ?? 0),
            0,
          );
          const stock = n(ingredient.currentStock);
          const daysCover = weeklyUse > 0 ? (stock / weeklyUse) * 7 : null;
          return {
            ingredientId: ingredient.id,
            name: ingredient.name,
            currentStock: stock,
            predictedUseNext7Days: round(weeklyUse, 3),
            daysOfCover: daysCover === null ? null : round(daysCover, 1),
            suggestedPurchase: round(Math.max(0, weeklyUse * 1.2 - stock), 3),
            risk:
              stock <= n(ingredient.reorderLevel) ||
              (daysCover !== null && daysCover < 3)
                ? 'HIGH'
                : daysCover !== null && daysCover < 7
                  ? 'MEDIUM'
                  : 'LOW',
          };
        })
        .sort((a, b) => {
          const order: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
          return order[a.risk]! - order[b.risk]!;
        }),
    };
  }

  async wastePrediction(branchId: string) {
    const logs = await this.prisma.wasteLog.findMany({
      where: { branchId, createdAt: { gte: this.since(60) } },
      include: { ingredient: { select: { name: true, currentStock: true } } },
    });
    const grouped = new Map<
      string,
      { name: string; recent: number; previous: number; cost: number }
    >();
    for (const log of logs) {
      const entry = grouped.get(log.ingredientId) ?? {
        name: log.ingredient.name,
        recent: 0,
        previous: 0,
        cost: 0,
      };
      const qty = n(log.quantity);
      if (log.createdAt >= this.since(30)) entry.recent += qty;
      else entry.previous += qty;
      entry.cost += qty * n(log.unitCostAtWaste);
      grouped.set(log.ingredientId, entry);
    }
    return {
      generatedAt: new Date(),
      risks: [...grouped.entries()]
        .map(([ingredientId, value]) => ({
          ingredientId,
          name: value.name,
          predictedWasteNext30Days: round(
            value.recent * 0.7 + value.previous * 0.3,
            3,
          ),
          wasteCost60Days: round(value.cost),
          trendPercent: value.previous
            ? round(((value.recent - value.previous) / value.previous) * 100)
            : null,
          risk:
            value.recent > value.previous * 1.25
              ? 'HIGH'
              : value.recent > value.previous
                ? 'MEDIUM'
                : 'LOW',
        }))
        .sort(
          (a, b) => b.predictedWasteNext30Days - a.predictedWasteNext30Days,
        ),
    };
  }

  async menuAnalysis(branchId: string) {
    const rows = await this.prisma.orderItem.findMany({
      where: {
        order: { branchId, status: 'PAID', createdAt: { gte: this.since(90) } },
      },
      include: { menuItem: { select: { costPrice: true } } },
    });
    const grouped = new Map<
      string,
      { name: string; qty: number; revenue: number; margin: number }
    >();
    for (const row of rows) {
      const item = grouped.get(row.menuItemId) ?? {
        name: row.nameSnapshot,
        qty: 0,
        revenue: 0,
        margin: 0,
      };
      item.qty += row.quantity;
      item.revenue += n(row.lineTotal);
      item.margin +=
        n(row.lineTotal) - n(row.menuItem.costPrice) * row.quantity;
      grouped.set(row.menuItemId, item);
    }
    const values = [...grouped.values()];
    const avgQty =
      values.reduce((s, x) => s + x.qty, 0) / Math.max(1, values.length);
    const avgMargin =
      values.reduce((s, x) => s + x.margin, 0) / Math.max(1, values.length);
    return {
      generatedAt: new Date(),
      items: [...grouped.entries()]
        .map(([menuItemId, item]) => ({
          menuItemId,
          name: item.name,
          quantitySold: item.qty,
          revenue: round(item.revenue),
          contributionMargin: round(item.margin),
          classification:
            item.qty >= avgQty && item.margin >= avgMargin
              ? 'STAR'
              : item.qty >= avgQty
                ? 'PLOWHORSE'
                : item.margin >= avgMargin
                  ? 'PUZZLE'
                  : 'DOG',
        }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  async customerChurn(branchId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { branchId },
      include: {
        orders: {
          where: { status: 'PAID' },
          select: { createdAt: true, totalAmount: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return {
      generatedAt: new Date(),
      customers: customers
        .filter((c) => c.orders.length > 0)
        .map((customer) => {
          const daysSince = Math.floor(
            (Date.now() - customer.orders[0].createdAt.getTime()) / DAY,
          );
          const visits = customer.orders.length;
          const spend = customer.orders.reduce(
            (sum, order) => sum + n(order.totalAmount),
            0,
          );
          const score = Math.min(
            100,
            Math.max(0, daysSince * 1.4 - visits * 2),
          );
          return {
            customerId: customer.id,
            name: customer.name ?? customer.phone ?? 'Guest',
            daysSinceLastOrder: daysSince,
            visits,
            lifetimeSpend: round(spend),
            churnScore: round(score),
            risk: score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW',
          };
        })
        .sort((a, b) => b.churnScore - a.churnScore),
    };
  }

  async askReport(branchId: string, question: string) {
    const q = question?.trim().toLowerCase();
    if (!q) throw new BadRequestException('question is required');
    if (/waste|spoil|expiry/.test(q))
      return { intent: 'WASTE', answer: await this.wastePrediction(branchId) };
    if (/stock|inventory|ingredient|purchase/.test(q))
      return {
        intent: 'INVENTORY',
        answer: await this.inventoryForecast(branchId),
      };
    if (/customer|churn|inactive/.test(q))
      return {
        intent: 'CUSTOMER_CHURN',
        answer: await this.customerChurn(branchId),
      };
    if (/menu|item|dish|profit|margin|selling/.test(q))
      return { intent: 'MENU', answer: await this.menuAnalysis(branchId) };
    if (/demand|forecast|next week|sale/.test(q))
      return { intent: 'DEMAND', answer: await this.demandForecast(branchId) };
    throw new BadRequestException(
      'Ask about demand, inventory, waste, menu performance or customer churn',
    );
  }
}
