import { Injectable, NotFoundException } from '@nestjs/common';
import type { CartItemDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PublicMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  private async resolveTable(qrToken: string) {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
      include: { floor: { include: { branch: true } } },
    });
    if (!table) throw new NotFoundException('This QR code is not recognized');
    return table;
  }

  async getMenuByQrToken(qrToken: string) {
    const table = await this.resolveTable(qrToken);
    const branch = table.floor.branch;

    const categories = await this.prisma.menuCategory.findMany({
      where: { branchId: branch.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            imageUrl: true,
            price: true,
            isVeg: true,
            isVegan: true,
            spiceLevel: true,
            allergens: true,
          },
        },
      },
    });

    return {
      branchName: branch.name,
      tableName: table.name ?? `Table ${table.number}`,
      categories,
    };
  }

  async createOrder(qrToken: string, items: CartItemDto[]) {
    const table = await this.resolveTable(qrToken);
    const branchId = table.floor.branchId;

    // A guest who already ordered once this visit and scans again to add
    // more (e.g. drinks now, food later) should land on the same tab, not
    // open a second order for the table — mirrors how staff add a round
    // from the POS for an occupied table.
    const openOrder = await this.prisma.order.findFirst({
      where: { branchId, tableId: table.id, status: 'OPEN' },
    });
    if (openOrder) {
      return this.ordersService.addItems(branchId, openOrder.id, items);
    }

    // A guest scanning a QR code has no staff account, but Order.createdById
    // is a required FK — attribute the order to whoever is on the floor for
    // this table (assigned waiter), falling back to any staff member linked
    // to the branch (every branch has at least its owner) so this never
    // fails for lack of a "system user" that doesn't otherwise exist.
    const createdById =
      table.assignedWaiterId ??
      (
        await this.prisma.userBranch.findFirst({
          where: { branchId },
          orderBy: { userId: 'asc' },
        })
      )?.userId;
    if (!createdById) {
      throw new NotFoundException(
        'This branch has no staff to receive the order',
      );
    }

    return this.ordersService.createOrder(branchId, createdById, {
      type: 'QR_ORDER',
      tableId: table.id,
      items,
    });
  }
}
