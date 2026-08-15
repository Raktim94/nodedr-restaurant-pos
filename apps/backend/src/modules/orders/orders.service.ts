import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CartItemDto,
  CheckoutDto,
  CreateOrderDto,
  RefundDto,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { computeOrderTotals, priceLine, round2 } from './pricing';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly giftCards: GiftCardsService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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

    // A client-supplied tableId/customerId that belongs to a different
    // branch/restaurant must never be trusted directly: without this check,
    // the order below would create a real FK link to another tenant's
    // table (and flip its status to OCCUPIED) or customer, and this
    // branch's own staff could then read that other tenant's table/customer
    // details back out via getOrder()/getReceiptData()'s `include`.
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, floor: { branchId } },
        select: { id: true },
      });
      if (!table) {
        throw new BadRequestException('Table is invalid for this branch');
      }
    }
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, branchId },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer is invalid for this branch');
      }
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
          guestName: dto.guestName,
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

    const full = await this.getOrder(branchId, order.id);

    // "New order" is targeted by permission, not a hardcoded role — any
    // custom role holding kds.manage (the same key that gates the KDS
    // screens themselves, see packages/types/src/permissions.ts) gets it,
    // so a renamed/custom kitchen role never silently stops receiving
    // orders. Best-effort: a notification failure must never fail order
    // creation, which has already committed by this point — log and move on.
    try {
      await this.notifications.notifyByPermission(branchId, 'kds.manage', {
        type: 'order.new',
        title: 'New order',
        body: full.table
          ? `Order ${full.orderNumber} — Table ${full.table.number}`
          : `Order ${full.orderNumber} (${full.type})`,
        entity: 'Order',
        entityId: full.id,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send order.new notification for order ${full.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return full;
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

  // Realistic floor rule: once the kitchen has actually started cooking (or
  // finished) any ticket, the order can no longer be cancelled from the
  // floor — food already in progress must be voided/wasted through
  // inventory instead, not silently disappeared. Cancelling is only safe
  // while every KOT is still NEW/ACCEPTED (queued, not yet fired).
  async cancelOrder(branchId: string, orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      include: { kots: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Only an open order can be cancelled');
    }
    const alreadyStarted = order.kots.some((kot) =>
      ['PREPARING', 'READY', 'SERVED'].includes(kot.status),
    );
    if (alreadyStarted) {
      throw new BadRequestException(
        'The kitchen has already started this order — it can no longer be cancelled from here',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
      await tx.kot.updateMany({
        where: { orderId, status: { notIn: ['SERVED', 'CANCELLED'] } },
        data: { status: 'CANCELLED' },
      });
      await tx.kotItem.updateMany({
        where: { kot: { orderId }, status: { notIn: ['SERVED', 'CANCELLED'] } },
        data: { status: 'CANCELLED' },
      });

      if (order.tableId) {
        const otherOpenOrders = await tx.order.count({
          where: {
            tableId: order.tableId,
            status: 'OPEN',
            id: { not: orderId },
          },
        });
        if (otherOpenOrders === 0) {
          await tx.table.update({
            where: { id: order.tableId },
            data: { status: 'AVAILABLE' },
          });
        }
      }
    });

    this.realtime.emitToBranch(branchId, 'order.updated', {
      id: orderId,
      status: 'CANCELLED',
    });
    this.realtime.emitToBranch(branchId, 'kot.updated', { orderId });

    await this.audit.record({
      userId,
      action: 'order.cancelled',
      entity: 'Order',
      entityId: orderId,
      metadata: {
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        type: order.type,
      },
    });

    return this.getOrder(branchId, orderId);
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

    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      include: { restaurant: true },
    });
    const loyaltyPointValue = Number(branch.restaurant.loyaltyPointValue);
    const loyaltyEarnPerCurrency = branch.restaurant.loyaltyEarnPerCurrency;

    // A customer can be attached at billing time instead of when the order
    // was opened — walk-ins don't need a name up front, staff can add one
    // once the guest is ready to pay. Falls back to whatever was already on
    // the order (e.g. attached via QR order or set at cart time).
    let effectiveCustomerId = order.customerId;
    if (!effectiveCustomerId && dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, branchId },
      });
      if (!customer) throw new BadRequestException('Customer not found');
      effectiveCustomerId = customer.id;
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
    if (pointsToRedeem > 0 && !effectiveCustomerId) {
      throw new BadRequestException(
        'Cannot redeem loyalty points without a customer on the order',
      );
    }
    const requestedLoyaltyDiscount = round2(
      Math.min(pointsToRedeem * loyaltyPointValue, totals.totalAmount),
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

      if (pointsToRedeem > 0 && effectiveCustomerId) {
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: effectiveCustomerId },
        });
        if (customer.loyaltyPoints < pointsToRedeem) {
          throw new BadRequestException(
            `Customer only has ${customer.loyaltyPoints} loyalty points available`,
          );
        }
        actualPointsRedeemed = pointsToRedeem;
        loyaltyDiscountAmount = requestedLoyaltyDiscount;
        // Guarded atomic decrement, not a read-then-write `set`: two
        // concurrent checkouts redeeming points for the same customer could
        // otherwise both read the same stale balance and one redemption
        // would be silently lost (customer effectively spends the same
        // points twice). The `loyaltyPoints: { gte }` guard only lets the
        // update through if the balance is still sufficient at update time.
        const redeemResult = await tx.customer.updateMany({
          where: {
            id: effectiveCustomerId,
            loyaltyPoints: { gte: pointsToRedeem },
          },
          data: { loyaltyPoints: { decrement: pointsToRedeem } },
        });
        if (redeemResult.count === 0) {
          throw new BadRequestException(
            'Customer loyalty balance changed — please retry checkout',
          );
        }
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
      // actually paid — an atomic increment (race-free by construction, no
      // read-then-write window) rather than a computed `set`.
      if (effectiveCustomerId) {
        const netSpend = round2(totals.totalAmount - loyaltyDiscountAmount);
        const pointsEarned = Math.floor(netSpend / loyaltyEarnPerCurrency);
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: effectiveCustomerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
          });
        }
      }

      // Table update runs first so the nested `table` include below reflects
      // the post-checkout status, not a stale pre-update snapshot.
      //
      // `status: 'OPEN'` in the where clause (an "extended where" filter,
      // supported since Prisma 4.5 for update/delete on a unique record) is
      // the actual concurrency guard: the initial `order.status !== 'OPEN'`
      // check above ran outside this transaction, so two simultaneous
      // checkout requests for the same order could otherwise both pass it
      // and both reach here, producing two payment rows, a double inventory
      // deduction, and double loyalty points. This update only succeeds if
      // the row is still OPEN at commit time; Prisma throws P2025 (caught
      // below) for the loser, and the whole transaction — including the
      // gift card debit and loyalty point changes already applied above —
      // rolls back with it.
      try {
        return await tx.order.update({
          where: { id: orderId, status: 'OPEN' },
          data: {
            ...(effectiveCustomerId && !order.customerId
              ? { customerId: effectiveCustomerId }
              : {}),
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
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2025'
        ) {
          throw new ConflictException(
            'This order was already checked out by another request.',
          );
        }
        throw err;
      }
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
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'PAID') {
      throw new BadRequestException('Only a paid order can be refunded');
    }

    const refund = await this.prisma.$transaction(async (tx) => {
      // Row lock: bumping the order row here (rather than only reading it)
      // holds a Postgres row lock for the rest of this transaction, so a
      // second concurrent refund request on the same order blocks here
      // until the first commits — then its own re-read of `refunds` below
      // sees the first refund and correctly recomputes what's still
      // refundable. Without this, two simultaneous refund requests could
      // both read the same pre-refund `refundable` amount and together
      // refund more than the order was ever paid for.
      await tx.order.update({
        where: { id: orderId },
        data: { updatedAt: new Date() },
      });
      const refunds = await tx.refund.findMany({ where: { orderId } });
      const alreadyRefunded = round2(
        refunds.reduce((sum, r) => sum + Number(r.amount), 0),
      );
      const refundable = round2(Number(order.totalAmount) - alreadyRefunded);
      if (dto.amount > refundable) {
        throw new BadRequestException(
          `Cannot refund ${dto.amount} — only ${refundable} remains refundable on this order`,
        );
      }

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
        // Atomic increment, not read-then-write: two concurrent
        // STORE_CREDIT refunds for the same customer (from different
        // orders) could otherwise both read the same stale walletBalance
        // and one credit would be silently lost.
        await tx.customer.update({
          where: { id: order.customerId },
          data: { walletBalance: { increment: dto.amount } },
        });
      }

      return created;
    });

    this.realtime.emitToBranch(branchId, 'order.updated', { id: orderId });

    await this.audit.record({
      userId,
      action: 'order.refunded',
      entity: 'Order',
      entityId: orderId,
      metadata: {
        orderNumber: order.orderNumber,
        amount: dto.amount,
        method: dto.method,
        reason: dto.reason,
      },
    });

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
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            table: { select: { assignedWaiterId: true, number: true } },
          },
        },
      },
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

    // Waiter assignment lives on Table (assignedWaiterId), not Order — a
    // KOT's order carries a table only for dine-in; takeaway/delivery orders
    // have no table and therefore no assigned waiter to notify, which is
    // exactly the "skip silently if not set" case.
    const assignedWaiterId = kot.order.table?.assignedWaiterId;
    if (status === 'READY' && assignedWaiterId) {
      try {
        await this.notifications.notifyUser(assignedWaiterId, branchId, {
          type: 'order.ready',
          title: 'Order ready',
          body: kot.order.table
            ? `Order ${kot.order.orderNumber} — Table ${kot.order.table.number} is ready to serve`
            : `Order ${kot.order.orderNumber} is ready to serve`,
          entity: 'Order',
          entityId: kot.order.id,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to send order.ready notification for order ${kot.order.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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
