import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CartItemDto,
  CheckoutDto,
  CreateOrderDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { computeOrderTotals, priceLine, round2 } from './pricing';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async listOpen(branchId: string) {
    return this.prisma.order.findMany({
      where: { branchId, status: 'OPEN' },
      include: { table: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrder(branchId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, branchId },
      include: {
        table: true,
        items: { include: { modifiers: true, menuItem: true } },
        kots: { include: { items: true, station: true } },
        payments: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async createOrder(branchId: string, userId: string, dto: CreateOrderDto) {
    const menuItemIds = [...new Set(dto.items.map((i) => i.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId },
    });
    if (menuItems.length !== menuItemIds.length) {
      throw new BadRequestException(
        'One or more menu items are invalid for this branch',
      );
    }
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    const modifierIds = [...new Set(dto.items.flatMap((i) => i.modifierIds))];
    const modifiers = await this.prisma.modifier.findMany({
      where: { id: { in: modifierIds } },
    });
    const modifierById = new Map(modifiers.map((m) => [m.id, m]));
    if (modifiers.length !== modifierIds.length) {
      throw new BadRequestException('One or more modifiers are invalid');
    }

    const lineInputs = dto.items.map((cartItem) =>
      this.buildLine(cartItem, menuItemById, modifierById),
    );
    const totals = computeOrderTotals(lineInputs.map((l) => l.priced));

    const orderNumber = await this.nextOrderNumber(branchId);

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          branchId,
          orderNumber,
          type: dto.type,
          tableId: dto.tableId,
          guestCount: dto.guestCount,
          customerId: dto.customerId,
          notes: dto.notes,
          createdById: userId,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discountAmount: 0,
          totalAmount: totals.subtotal,
          items: {
            create: lineInputs.map((line) => ({
              menuItem: { connect: { id: line.menuItem.id } },
              nameSnapshot: line.menuItem.name,
              unitPriceSnapshot: line.menuItem.price,
              taxRateSnapshot: line.menuItem.taxRatePercent,
              quantity: line.cartItem.quantity,
              lineTotal: line.priced.lineTotal,
              kitchenNote: line.cartItem.kitchenNote,
              modifiers: {
                create: line.selectedModifiers.map((m) => ({
                  modifier: { connect: { id: m.id } },
                  nameSnapshot: m.name,
                  priceAdjSnapshot: m.priceAdjustment,
                })),
              },
            })),
          },
        },
        include: { items: true },
      });

      if (dto.tableId) {
        await tx.table.update({
          where: { id: dto.tableId },
          data: { status: 'OCCUPIED' },
        });
      }

      await this.generateKots(tx, created.id, branchId, created.items);

      return created;
    });

    this.realtime.emitToBranch(branchId, 'order.created', { id: order.id });
    return this.getOrder(branchId, order.id);
  }

  async checkout(branchId: string, orderId: string, dto: CheckoutDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Order is not open for checkout');
    }

    const lines = order.items.map((item) =>
      priceLine({
        quantity: item.quantity,
        unitPriceInclusive: Number(item.lineTotal) / item.quantity,
        taxRatePercent: Number(item.taxRateSnapshot),
      }),
    );
    const totals = computeOrderTotals(
      lines,
      dto.discountPercent ?? 0,
      dto.discountFlat ?? 0,
    );

    const paidAmount = round2(
      dto.payments.reduce((sum, p) => sum + p.amount, 0),
    );
    if (paidAmount < totals.totalAmount) {
      throw new BadRequestException(
        `Payments (${paidAmount}) do not cover the total due (${totals.totalAmount})`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (order.tableId) {
        await tx.table.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
      }

      // Table update runs first so the nested `table` include below reflects
      // the post-checkout status, not a stale pre-update snapshot.
      return tx.order.update({
        where: { id: orderId },
        data: {
          discountAmount: totals.discountAmount,
          totalAmount: totals.totalAmount,
          status: 'PAID',
          billedAt: new Date(),
          payments: { create: dto.payments },
        },
        include: { payments: true, table: true },
      });
    });

    this.realtime.emitToBranch(branchId, 'order.updated', {
      id: updated.id,
      status: 'PAID',
    });
    return updated;
  }

  private buildLine(
    cartItem: CartItemDto,
    menuItemById: Map<string, Prisma.MenuItemGetPayload<Record<string, never>>>,
    modifierById: Map<string, Prisma.ModifierGetPayload<Record<string, never>>>,
  ) {
    const menuItem = menuItemById.get(cartItem.menuItemId);
    if (!menuItem) throw new BadRequestException('Menu item not found');

    const selectedModifiers = cartItem.modifierIds.map((id) => {
      const modifier = modifierById.get(id);
      if (!modifier) throw new BadRequestException('Modifier not found');
      return modifier;
    });

    const basePrice = Number(menuItem.price);
    const modifierTotal = selectedModifiers.reduce(
      (sum, m) => sum + Number(m.priceAdjustment),
      0,
    );
    const unitPriceInclusive = round2(basePrice + modifierTotal);

    const priced = priceLine({
      quantity: cartItem.quantity,
      unitPriceInclusive,
      taxRatePercent: Number(menuItem.taxRatePercent),
    });

    return {
      cartItem,
      menuItem: {
        id: menuItem.id,
        name: menuItem.name,
        price: basePrice,
        taxRatePercent: Number(menuItem.taxRatePercent),
      },
      selectedModifiers,
      priced,
    };
  }

  private async nextOrderNumber(branchId: string): Promise<string> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const countToday = await this.prisma.order.count({
      where: { branchId, createdAt: { gte: startOfDay } },
    });

    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${datePart}-${String(countToday + 1).padStart(4, '0')}`;
  }

  private async generateKots(
    tx: Prisma.TransactionClient,
    orderId: string,
    branchId: string,
    orderItems: { id: string; menuItemId: string }[],
  ) {
    const stationLookup = await tx.menuItem.findMany({
      where: { id: { in: orderItems.map((i) => i.menuItemId) } },
      select: { id: true, stationId: true },
    });
    const stationByMenuItem = new Map(
      stationLookup.map((m) => [m.id, m.stationId]),
    );

    const itemsByStation = new Map<string | null, typeof orderItems>();
    for (const item of orderItems) {
      const stationId = stationByMenuItem.get(item.menuItemId) ?? null;
      const bucket = itemsByStation.get(stationId) ?? [];
      bucket.push(item);
      itemsByStation.set(stationId, bucket);
    }

    let ticketSeq = 1;
    for (const [stationId, items] of itemsByStation) {
      const kot = await tx.kot.create({
        data: {
          orderId,
          stationId: stationId ?? undefined,
          ticketNumber: `${orderId.slice(-6)}-${ticketSeq++}`,
          items: { create: items.map((item) => ({ orderItemId: item.id })) },
        },
      });
      this.realtime.emitToBranch(branchId, 'kot.created', {
        id: kot.id,
        stationId,
      });
    }
  }

  async updateKotStatus(branchId: string, kotId: string, status: string) {
    const kot = await this.prisma.kot.findFirst({
      where: { id: kotId, order: { branchId } },
    });
    if (!kot) throw new NotFoundException('KOT not found');

    const timestamps: Record<string, Date> = {};
    if (status === 'ACCEPTED') timestamps.acceptedAt = new Date();
    if (status === 'READY') timestamps.readyAt = new Date();
    if (status === 'SERVED') timestamps.servedAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.kot.update({
        where: { id: kotId },
        data: { status: status as never, ...timestamps },
      });
      await tx.kotItem.updateMany({
        where: { kotId },
        data: { status: status as never },
      });
      return result;
    });

    this.realtime.emitToBranch(branchId, 'kot.updated', updated);
    return updated;
  }

  async reprintKot(branchId: string, kotId: string) {
    const kot = await this.prisma.kot.findFirst({
      where: { id: kotId, order: { branchId } },
    });
    if (!kot) throw new NotFoundException('KOT not found');

    const updated = await this.prisma.kot.update({
      where: { id: kotId },
      data: { printedCount: { increment: 1 } },
    });
    this.realtime.emitToBranch(branchId, 'kot.reprinted', {
      id: updated.id,
      printedCount: updated.printedCount,
    });
    return updated;
  }

  async setKotPriority(branchId: string, kotId: string, isPriority: boolean) {
    const kot = await this.prisma.kot.findFirst({
      where: { id: kotId, order: { branchId } },
    });
    if (!kot) throw new NotFoundException('KOT not found');

    const updated = await this.prisma.kot.update({
      where: { id: kotId },
      data: { isPriority },
    });
    this.realtime.emitToBranch(branchId, 'kot.updated', updated);
    return updated;
  }
}
