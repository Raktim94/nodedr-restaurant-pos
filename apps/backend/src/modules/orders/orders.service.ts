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
  RefundDto,
} from '@nodedr-restaurant/types';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { computeOrderTotals, priceLine, round2 } from './pricing';

// 1 loyalty point = ₹1 of discount when redeemed; 1 point earned per ₹100
// spent (floor) on the final tax-inclusive total, excluding tip. Both are
// deliberately simple, fixed constants for now — a per-restaurant
// configurable loyalty program is a Phase-later refinement, not silently
// hardcoded forever.
const LOYALTY_POINT_VALUE = 1;
const LOYALTY_EARN_PER_CURRENCY = 100;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly giftCards: GiftCardsService,
    private readonly inventory: InventoryService,
  ) {}

  async listOpen(branchId: string, tableId?: string) {
    return this.prisma.order.findMany({
      where: { branchId, status: 'OPEN', ...(tableId ? { tableId } : {}) },
      include: { table: true, items: true, customer: true },
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

  async getReceiptData(branchId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, branchId },
      include: {
        table: true,
        customer: true,
        items: { include: { modifiers: true } },
        payments: true,
        branch: { include: { restaurant: true } },
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

  async addItems(branchId: string, orderId: string, items: CartItemDto[]) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Order is not open — cannot add items');
    }

    const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branchId },
    });
    if (menuItems.length !== menuItemIds.length) {
      throw new BadRequestException(
        'One or more menu items are invalid for this branch',
      );
    }
    const menuItemById = new Map(menuItems.map((m) => [m.id, m]));

    const modifierIds = [...new Set(items.flatMap((i) => i.modifierIds))];
    const modifiers = await this.prisma.modifier.findMany({
      where: { id: { in: modifierIds } },
    });
    const modifierById = new Map(modifiers.map((m) => [m.id, m]));
    if (modifiers.length !== modifierIds.length) {
      throw new BadRequestException('One or more modifiers are invalid');
    }

    const lineInputs = items.map((cartItem) =>
      this.buildLine(cartItem, menuItemById, modifierById),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const newItems = await Promise.all(
        lineInputs.map((line) =>
          tx.orderItem.create({
            data: {
              orderId,
              menuItemId: line.menuItem.id,
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
            },
          }),
        ),
      );

      const allLines = [...order.items, ...newItems].map((item) =>
        priceLine({
          quantity: item.quantity,
          unitPriceInclusive: Number(item.lineTotal) / item.quantity,
          taxRatePercent: Number(item.taxRateSnapshot),
        }),
      );
      const totals = computeOrderTotals(allLines);

      const result = await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.subtotal,
        },
      });

      await this.generateKots(tx, orderId, branchId, newItems);

      return result;
    });

    this.realtime.emitToBranch(branchId, 'order.updated', { id: orderId });
    return this.getOrder(branchId, updated.id);
  }

  async checkout(
    branchId: string,
    orderId: string,
    userId: string,
    dto: CheckoutDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      include: { items: true, customer: true },
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

    // Loyalty redemption is a further flat discount on top of
    // discountPercent/discountFlat — capped so it can never make the bill
    // negative, and capped by the customer's actual point balance (checked
    // again inside the transaction against a fresh read, not this
    // pre-transaction snapshot, to avoid a stale-balance race).
    const pointsToRedeem = dto.loyaltyPointsToRedeem ?? 0;
    if (pointsToRedeem > 0 && !order.customerId) {
      throw new BadRequestException(
        'Cannot redeem loyalty points without a customer on the order',
      );
    }
    const requestedLoyaltyDiscount = round2(
      Math.min(pointsToRedeem * LOYALTY_POINT_VALUE, totals.totalAmount),
    );
    const totalDue = round2(
      totals.totalAmount - requestedLoyaltyDiscount + (dto.tipAmount ?? 0),
    );

    const tipAmount = round2(dto.tipAmount ?? 0);
    const manualPaymentsTotal = round2(
      dto.payments.reduce((sum, p) => sum + p.amount, 0),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      let loyaltyDiscountAmount = 0;
      let actualPointsRedeemed = 0;

      if (pointsToRedeem > 0 && order.customerId) {
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: order.customerId },
        });
        if (customer.loyaltyPoints < pointsToRedeem) {
          throw new BadRequestException(
            `Customer only has ${customer.loyaltyPoints} loyalty points available`,
          );
        }
        actualPointsRedeemed = pointsToRedeem;
        loyaltyDiscountAmount = requestedLoyaltyDiscount;
        await tx.customer.update({
          where: { id: order.customerId },
          data: { loyaltyPoints: customer.loyaltyPoints - pointsToRedeem },
        });
      }

      let giftCardAmountApplied = 0;
      if (dto.giftCardCode) {
        const remainingAfterManual = round2(totalDue - manualPaymentsTotal);
        if (remainingAfterManual > 0) {
          const result = await this.giftCards.debit(
            tx,
            branchId,
            dto.giftCardCode,
            remainingAfterManual,
          );
          giftCardAmountApplied = result.amountApplied;
          await tx.giftCardRedemption.create({
            data: {
              giftCardId: result.giftCardId,
              orderId,
              amount: giftCardAmountApplied,
            },
          });
        }
      }

      const totalCovered = round2(manualPaymentsTotal + giftCardAmountApplied);
      if (totalCovered < totalDue) {
        throw new BadRequestException(
          `Payments (${totalCovered}) do not cover the total due (${totalDue})`,
        );
      }

      // Best-effort, non-blocking: deducts ingredient stock for whichever
      // items have a recipe modeled (most won't yet). See
      // InventoryService.deductForOrderItems for why this never throws on
      // insufficient stock — a recipe-modeling gap must never be the reason
      // a paid order fails to save.
      await this.inventory.deductForOrderItems(
        tx,
        branchId,
        userId,
        order.items.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
        })),
      );

      if (order.tableId) {
        await tx.table.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
      }

      // Loyalty earn on net spend (excluding tip), only once the sale is
      // actually paid — read-modify-write with a plain integer, not a DB
      // increment, so it stays consistent with the redeem path above.
      if (order.customerId) {
        const netSpend = round2(totals.totalAmount - loyaltyDiscountAmount);
        const pointsEarned = Math.floor(netSpend / LOYALTY_EARN_PER_CURRENCY);
        if (pointsEarned > 0) {
          const customer = await tx.customer.findUniqueOrThrow({
            where: { id: order.customerId },
          });
          await tx.customer.update({
            where: { id: order.customerId },
            data: { loyaltyPoints: customer.loyaltyPoints + pointsEarned },
          });
        }
      }

      // Table update runs first so the nested `table` include below reflects
      // the post-checkout status, not a stale pre-update snapshot.
      return tx.order.update({
        where: { id: orderId },
        data: {
          discountAmount: totals.discountAmount,
          loyaltyPointsRedeemed: actualPointsRedeemed,
          loyaltyDiscountAmount,
          tipAmount,
          totalAmount: totalDue,
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

  async refund(
    branchId: string,
    orderId: string,
    userId: string,
    dto: RefundDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      include: { refunds: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PAID') {
      throw new BadRequestException('Only a paid order can be refunded');
    }

    const alreadyRefunded = round2(
      order.refunds.reduce((sum, r) => sum + Number(r.amount), 0),
    );
    const refundable = round2(Number(order.totalAmount) - alreadyRefunded);
    if (dto.amount > refundable) {
      throw new BadRequestException(
        `Cannot refund ${dto.amount} — only ${refundable} remains refundable on this order`,
      );
    }

    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          orderId,
          amount: dto.amount,
          reason: dto.reason,
          method: dto.method,
          createdById: userId,
        },
      });

      if (dto.method === 'STORE_CREDIT' && order.customerId) {
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: order.customerId },
        });
        await tx.customer.update({
          where: { id: order.customerId },
          data: {
            walletBalance: round2(Number(customer.walletBalance) + dto.amount),
          },
        });
      }

      return created;
    });

    this.realtime.emitToBranch(branchId, 'order.updated', { id: orderId });
    return refund;
  }

  async mergeOrders(
    branchId: string,
    targetOrderId: string,
    sourceOrderId: string,
  ) {
    if (targetOrderId === sourceOrderId) {
      throw new BadRequestException('Cannot merge an order into itself');
    }
    const [target, source] = await Promise.all([
      this.prisma.order.findFirst({ where: { id: targetOrderId, branchId } }),
      this.prisma.order.findFirst({ where: { id: sourceOrderId, branchId } }),
    ]);
    if (!target || !source) throw new NotFoundException('Order not found');
    if (target.status !== 'OPEN' || source.status !== 'OPEN') {
      throw new BadRequestException('Both orders must be open to merge');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { orderId: sourceOrderId },
        data: { orderId: targetOrderId },
      });
      await tx.kot.updateMany({
        where: { orderId: sourceOrderId },
        data: { orderId: targetOrderId },
      });

      const items = await tx.orderItem.findMany({
        where: { orderId: targetOrderId },
      });
      const lines = items.map((item) =>
        priceLine({
          quantity: item.quantity,
          unitPriceInclusive: Number(item.lineTotal) / item.quantity,
          taxRatePercent: Number(item.taxRateSnapshot),
        }),
      );
      // Discount is intentionally not recomputed here — it's re-entered at
      // checkout time for the merged bill, same as any other order.
      const totals = computeOrderTotals(lines);

      const result = await tx.order.update({
        where: { id: targetOrderId },
        data: {
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.subtotal,
        },
        include: { items: true },
      });

      await tx.order.update({
        where: { id: sourceOrderId },
        data: {
          status: 'CANCELLED',
          notes: `Merged into order ${target.orderNumber}`,
        },
      });

      if (source.tableId && source.tableId !== target.tableId) {
        await tx.table.update({
          where: { id: source.tableId },
          data: { status: 'AVAILABLE' },
        });
      }

      return result;
    });

    this.realtime.emitToBranch(branchId, 'order.updated', {
      id: targetOrderId,
    });
    this.realtime.emitToBranch(branchId, 'order.updated', {
      id: sourceOrderId,
    });
    return this.getOrder(branchId, updated.id);
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

    // Start after any KOTs this order already has — addItems() can call this
    // a second time for a later round, and ticket numbers must stay unique
    // per order for kitchen staff to tell rounds apart.
    let ticketSeq = (await tx.kot.count({ where: { orderId } })) + 1;
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
