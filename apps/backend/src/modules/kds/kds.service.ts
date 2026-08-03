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
}
