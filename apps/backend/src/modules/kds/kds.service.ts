import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class KdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  async listActiveTickets(branchId: string, stationId?: string) {
    return this.prisma.kot.findMany({
      where: {
        order: { branchId },
        status: { notIn: ['SERVED', 'CANCELLED'] },
        ...(stationId ? { stationId } : {}),
      },
      include: {
        station: true,
        order: { select: { orderNumber: true, type: true, table: true } },
        items: { include: { orderItem: { include: { modifiers: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  updateStatus(branchId: string, kotId: string, status: string) {
    return this.ordersService.updateKotStatus(branchId, kotId, status);
  }

  reprint(branchId: string, kotId: string) {
    return this.ordersService.reprintKot(branchId, kotId);
  }

  setPriority(branchId: string, kotId: string, isPriority: boolean) {
    return this.ordersService.setKotPriority(branchId, kotId, isPriority);
  }

  async getPerformanceReport(branchId: string, date?: string) {
    const start = date ? new Date(date) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const kots = await this.prisma.kot.findMany({
      where: {
        order: { branchId },
        createdAt: { gte: start, lt: end },
        readyAt: { not: null },
      },
      select: {
        stationId: true,
        createdAt: true,
        readyAt: true,
        station: { select: { name: true } },
      },
    });

    const byStation = new Map<
      string,
      { name: string; totalMinutes: number; count: number }
    >();
    for (const kot of kots) {
      const key = kot.stationId ?? 'unassigned';
      const name = kot.station?.name ?? 'Unassigned';
      const minutes =
        (kot.readyAt!.getTime() - kot.createdAt.getTime()) / 60_000;
      const bucket = byStation.get(key) ?? { name, totalMinutes: 0, count: 0 };
      bucket.totalMinutes += minutes;
      bucket.count += 1;
      byStation.set(key, bucket);
    }

    return Array.from(byStation.entries()).map(([stationId, bucket]) => ({
      stationId,
      stationName: bucket.name,
      ticketsReady: bucket.count,
      avgMinutesToReady:
        Math.round((bucket.totalMinutes / bucket.count) * 10) / 10,
    }));
  }
}
