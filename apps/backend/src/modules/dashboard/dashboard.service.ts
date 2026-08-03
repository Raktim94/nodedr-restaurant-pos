import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(branchId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [revenueAgg, ordersToday, tableCounts, kitchenQueue, recentOrders] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: { branchId, status: 'PAID', billedAt: { gte: startOfDay } },
          _sum: { totalAmount: true },
        }),
        this.prisma.order.count({
          where: { branchId, createdAt: { gte: startOfDay } },
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

    const tableStatusMap = Object.fromEntries(
      tableCounts.map((row) => [row.status, row._count]),
    );
    const kitchenQueueMap = Object.fromEntries(
      kitchenQueue.map((row) => [row.status, row._count]),
    );

    return {
      todayRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
      todayOrders: ordersToday,
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
    };
  }
}
