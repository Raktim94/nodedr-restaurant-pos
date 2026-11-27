import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  addDaysToDate,
  localDate,
  localDateFormatter,
  storedTimeZone,
  zonedRange,
} from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizePrefs, type DashboardPrefs } from './dashboard-prefs';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async restaurantFor(branchId: string) {
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { restaurant: { select: { currency: true, timezone: true } } },
    });
    return {
      currency: branch.restaurant.currency,
      timezone: storedTimeZone(branch.restaurant.timezone),
    };
  }

  async getSummary(branchId: string, permissions: string[] = []) {
    const { currency, timezone } = await this.restaurantFor(branchId);
    const today = localDate(new Date(), timezone);
    const range = zonedRange(today, today, timezone);

    const [
      revenueAgg,
      ordersToday,
      orderTypeCounts,
      tableCounts,
      kitchenQueue,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: { branchId, status: 'PAID', billedAt: range },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({
        where: { branchId, createdAt: range },
      }),
      this.prisma.order.groupBy({
        by: ['channel'],
        where: { branchId, createdAt: range },
        _count: true,
      }),
      this.prisma.table.groupBy({
        by: ['status'],
        where: { floor: { branchId } },
        _count: true,
      }),
      this.prisma.kot.groupBy({
        by: ['status'],
        where: {
          order: { branchId },
          status: { notIn: ['SERVED', 'CANCELLED'] },
        },
        _count: true,
      }),
      this.prisma.order.findMany({
        where: { branchId, status: 'PAID' },
        orderBy: { billedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          type: true,
          totalAmount: true,
          billedAt: true,
        },
      }),
    ]);

    const has = (p: string) => permissions.includes(p);
    const attention = await this.attention(branchId, has);

    const tableStatusMap = Object.fromEntries(
      tableCounts.map((row) => [row.status, row._count]),
    );
    const kitchenQueueMap = Object.fromEntries(
      kitchenQueue.map((row) => [row.status, row._count]),
    );
    // Online = placed by a guest through the website or QR (Order.channel),
    // everything else was rung up by staff.
    const channels = orderTypeCounts.reduce(
      (acc, row) => {
        if (row.channel === 'ONLINE') {
          acc.online += row._count;
        } else {
          acc.offline += row._count;
        }
        return acc;
      },
      { online: 0, offline: 0 },
    );

    return {
      currency,
      todayRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
      todayOrders: ordersToday,
      channels,
      tables: {
        available: tableStatusMap.AVAILABLE ?? 0,
        occupied: tableStatusMap.OCCUPIED ?? 0,
        reserved: tableStatusMap.RESERVED ?? 0,
        cleaning: tableStatusMap.CLEANING ?? 0,
        outOfService: tableStatusMap.OUT_OF_SERVICE ?? 0,
      },
      kitchenQueue: {
        new: kitchenQueueMap.NEW ?? 0,
        accepted: kitchenQueueMap.ACCEPTED ?? 0,
        preparing: kitchenQueueMap.PREPARING ?? 0,
        ready: kitchenQueueMap.READY ?? 0,
      },
      recentOrders,
      ...attention,
    };
  }

  // Figures that need a person to act. Each one is only computed (and so only
  // ever returned) for a role allowed to see it; the rest come back null.
  private async attention(branchId: string, has: (p: string) => boolean) {
    const [pending, lowStock, customers, employees, draftPayroll] =
      await Promise.all([
        // Bills with money taken but not settled: the balance still owed.
        this.prisma.order.findMany({
          where: {
            branchId,
            status: 'OPEN',
            payments: { some: {} },
          },
          select: { totalAmount: true, payments: { select: { amount: true } } },
        }),
        has('inventory.manage')
          ? this.prisma.ingredient.findMany({
              where: { branchId },
              select: { currentStock: true, reorderLevel: true },
            })
          : null,
        has('customers.manage')
          ? this.prisma.customer.count({ where: { branchId } })
          : null,
        has('staff.manage')
          ? this.prisma.user.count({
              where: { isActive: true, branches: { some: { branchId } } },
            })
          : null,
        has('staff.manage')
          ? this.prisma.payrollRun.count({
              where: { branchId, status: { in: ['DRAFT', 'FINALIZED'] } },
            })
          : null,
      ]);

    const owed = pending.reduce((sum, o) => {
      const paid = o.payments.reduce((p, x) => p + Number(x.amount), 0);
      return sum + Math.max(Number(o.totalAmount) - paid, 0);
    }, 0);
    return {
      pendingPayments: {
        count: pending.length,
        balance: Math.round(owed * 100) / 100,
      },
      lowStock:
        lowStock === null
          ? null
          : lowStock.filter(
              (i) => Number(i.currentStock) <= Number(i.reorderLevel),
            ).length,
      customers,
      employees,
      unpaidPayrollRuns: draftPayroll,
    };
  }

  async getPreferences(userId: string): Promise<DashboardPrefs> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dashboardPrefs: true },
    });
    return sanitizePrefs(user?.dashboardPrefs);
  }

  async setPreferences(userId: string, raw: unknown): Promise<DashboardPrefs> {
    // Layout only. Nothing here can change the figures a widget shows.
    const prefs = sanitizePrefs(raw);
    await this.prisma.user.update({
      where: { id: userId },
      data: { dashboardPrefs: prefs as unknown as Prisma.InputJsonValue },
    });
    return prefs;
  }

  async getTrends(branchId: string, days = 14) {
    const { timezone } = await this.restaurantFor(branchId);
    const dateFormat = localDateFormatter(timezone);
    const today = dateFormat.format(new Date());
    const firstDay = addDaysToDate(today, 1 - days);
    const range = zonedRange(firstDay, today, timezone);

    const [orders, wasteLogs] = await Promise.all([
      this.prisma.order.findMany({
        where: { branchId, status: 'PAID', billedAt: range },
        select: { totalAmount: true, billedAt: true },
      }),
      this.prisma.wasteLog.findMany({
        where: { branchId, createdAt: range },
        select: { quantity: true, unitCostAtWaste: true, createdAt: true },
      }),
    ]);

    const revenueByDay = new Map<string, number>();
    const wasteByDay = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const key = addDaysToDate(firstDay, i);
      revenueByDay.set(key, 0);
      wasteByDay.set(key, 0);
    }

    for (const order of orders) {
      if (!order.billedAt) continue;
      const key = dateFormat.format(order.billedAt);
      if (revenueByDay.has(key)) {
        revenueByDay.set(
          key,
          revenueByDay.get(key)! + Number(order.totalAmount),
        );
      }
    }

    for (const log of wasteLogs) {
      const key = dateFormat.format(log.createdAt);
      if (wasteByDay.has(key)) {
        const cost = Number(log.quantity) * Number(log.unitCostAtWaste);
        wasteByDay.set(key, wasteByDay.get(key)! + cost);
      }
    }

    return {
      revenue: [...revenueByDay.entries()].map(([date, amount]) => ({
        date,
        amount: Math.round(amount * 100) / 100,
      })),
      waste: [...wasteByDay.entries()].map(([date, cost]) => ({
        date,
        cost: Math.round(cost * 100) / 100,
      })),
    };
  }
}
