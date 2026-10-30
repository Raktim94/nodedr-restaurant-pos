import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  CreateIntegrationOrderDto,
  CreateIntegrationReservationDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryService } from '../modules/delivery/delivery.service';
import { OrdersService } from '../modules/orders/orders.service';
import { ReservationsService } from '../modules/reservations/reservations.service';

/** Extra scope that unlocks customer contact and delivery address on reads. */
export const PERSONAL_DATA_SCOPE = 'orders:read_customer';

const OWN_ORDER_INCLUDE = {
  items: { include: { modifiers: true }, orderBy: { id: 'asc' } },
  customer: { select: { name: true, phone: true, email: true } },
  kots: { select: { status: true } },
  payments: { select: { amount: true } },
} satisfies Prisma.OrderInclude;

type OwnOrder = Prisma.OrderGetPayload<{ include: typeof OWN_ORDER_INCLUDE }>;

export interface IntegrationKeyContext {
  id: string;
  restaurantId: string;
  branchId: string | null;
  scopes: string[];
}

/**
 * Backs the public REST API external websites use as a backend (see
 * docs/integrations-api.md). Every method takes the caller's
 * IntegrationKeyContext and re-validates the requested branch belongs to
 * that key's restaurant AND (if the key itself is scoped to one location)
 * matches exactly — never trusts a client-supplied branchId on its own,
 * same discipline OrdersService/ReservationsService already apply to
 * staff-supplied tableId/customerId.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly delivery: DeliveryService,
    private readonly reservations: ReservationsService,
  ) {}

  private async assertBranch(ctx: IntegrationKeyContext, branchId: string) {
    if (ctx.branchId && ctx.branchId !== branchId) {
      throw new ForbiddenException(
        'This API key is scoped to a different location',
      );
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId: ctx.restaurantId, isActive: true },
    });
    if (!branch) {
      throw new NotFoundException('Location not found');
    }
    return branch;
  }

  async listLocations(ctx: IntegrationKeyContext) {
    return this.prisma.branch.findMany({
      where: {
        restaurantId: ctx.restaurantId,
        isActive: true,
        ...(ctx.branchId ? { id: ctx.branchId } : {}),
      },
      select: { id: true, name: true, address: true, phone: true },
      orderBy: { name: 'asc' },
    });
  }

  async getMenu(ctx: IntegrationKeyContext, branchId: string) {
    const branch = await this.assertBranch(ctx, branchId);
    const categories = await this.prisma.menuCategory.findMany({
      where: { branchId: branch.id, isActive: true, showOnWebsite: true },
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
            taxRatePercent: true,
            isVeg: true,
            isVegan: true,
            spiceLevel: true,
            allergens: true,
            // "HH:mm" window the item can be ordered in, if the owner set one.
            availableFrom: true,
            availableTo: true,
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              select: {
                modifierGroup: {
                  select: {
                    id: true,
                    name: true,
                    minSelect: true,
                    maxSelect: true,
                    isRequired: true,
                    modifiers: {
                      orderBy: { sortOrder: 'asc' },
                      select: {
                        id: true,
                        name: true,
                        priceAdjustment: true,
                        isDefault: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    return {
      locationId: branch.id,
      locationName: branch.name,
      categories: categories.map((category) => ({
        ...category,
        items: category.items.map(({ modifierGroups, ...item }) => ({
          ...item,
          modifierGroups: modifierGroups.map((g) => g.modifierGroup),
        })),
      })),
    };
  }

  async createOrder(
    ctx: IntegrationKeyContext,
    branchId: string,
    dto: CreateIntegrationOrderDto,
    idempotencyKey?: string,
  ) {
    await this.assertBranch(ctx, branchId);

    // Scoped to the key so two websites can never collide on (or probe) each
    // other's idempotency keys.
    const clientRequestId = idempotencyKey
      ? `int:${ctx.id}:${idempotencyKey}`
      : undefined;
    // The same key must mean the same request: a different body under a used
    // key is a client bug, so say so instead of silently returning another order.
    const clientRequestHash = createHash('sha256')
      .update(JSON.stringify(dto))
      .digest('hex');
    const replayOf = (order: OwnOrder) => {
      if (order.clientRequestHash !== clientRequestHash) {
        throw new UnprocessableEntityException(
          'This Idempotency-Key was already used with a different request',
        );
      }
      return this.present(ctx, order);
    };
    if (clientRequestId) {
      const replay = await this.findOwnOrder(ctx, branchId, {
        clientRequestId,
      });
      if (replay) return replayOf(replay);
    }

    // find-or-attach a lightweight Customer record so repeat integration
    // orders from the same phone number accumulate under one profile —
    // same idea as the in-app POS's walk-in customer capture, just keyed
    // by phone since that's the only identity an external order carries.
    const existing = await this.prisma.customer.findFirst({
      where: { branchId, phone: dto.customerPhone },
    });
    const customer = existing
      ? await this.prisma.customer.update({
          where: { id: existing.id },
          data: {
            name: dto.customerName || existing.name,
            ...(dto.customerEmail && !existing.email
              ? { email: dto.customerEmail }
              : {}),
          },
        })
      : await this.prisma.customer.create({
          data: {
            branchId,
            name: dto.customerName,
            phone: dto.customerPhone,
            email: dto.customerEmail,
          },
        });

    // An external order has no staff member behind it, but Order.createdById
    // is a required FK — attribute it to any staff linked to the branch
    // (every branch has at least its owner), same fallback the QR
    // self-order flow already uses for the identical reason.
    const createdById = (
      await this.prisma.userBranch.findFirst({
        where: { branchId },
        orderBy: { userId: 'asc' },
      })
    )?.userId;
    if (!createdById) {
      throw new NotFoundException(
        'This location has no staff to receive the order',
      );
    }

    // Prices, tax and the delivery fee are all worked out by OrdersService
    // from the live menu and the location's zones; nothing monetary from the
    // caller is read (the schema strips unknown fields).
    for (let attempt = 1; ; attempt++) {
      try {
        const created = await this.orders.createOrder(
          branchId,
          createdById,
          {
            type: dto.type,
            customerId: customer.id,
            guestName: dto.customerName,
            notes: dto.notes,
            // A delivery order always carries its contact details, even for
            // a location that has no delivery zones configured.
            delivery: dto.delivery && {
              address: dto.delivery.address,
              pincode: dto.delivery.pincode,
              phone: dto.delivery.phone ?? dto.customerPhone,
            },
            scheduledFor: dto.scheduledFor,
            items: dto.items.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              modifierIds: item.modifierIds,
              kitchenNote: item.kitchenNote,
            })),
          },
          {
            channel: 'ONLINE',
            requireAcceptance: true,
            clientRequestId,
            clientRequestHash,
            integrationKeyId: ctx.id,
          },
        );
        const order = await this.findOwnOrder(ctx, branchId, {
          id: created.id,
        });
        return this.present(ctx, order!);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // A concurrent retry with the same Idempotency-Key won the race...
          if (clientRequestId) {
            const dup = await this.findOwnOrder(ctx, branchId, {
              clientRequestId,
            });
            if (dup) return replayOf(dup);
          }
          // ...or two orders raced for the same daily order number.
          if (attempt < 3) continue;
        }
        throw err;
      }
    }
  }

  /** Fee / minimum / ETA for a pincode, so a website can quote before ordering. */
  async deliveryQuote(
    ctx: IntegrationKeyContext,
    branchId: string,
    pincode: string,
  ) {
    await this.assertBranch(ctx, branchId);
    return this.delivery.quote(branchId, pincode);
  }

  /**
   * An order this key placed, with its status, items and totals. Customer and
   * delivery details are only included when `includeCustomer` is requested,
   * which needs the separate `orders:read_customer` scope.
   */
  async getOrder(
    ctx: IntegrationKeyContext,
    branchId: string,
    orderId: string,
    includeCustomer = false,
  ) {
    if (includeCustomer && !ctx.scopes.includes(PERSONAL_DATA_SCOPE)) {
      throw new ForbiddenException(
        `Reading customer details needs the ${PERSONAL_DATA_SCOPE} scope`,
      );
    }
    await this.assertBranch(ctx, branchId);
    const order = await this.findOwnOrder(ctx, branchId, { id: orderId });
    // Same 404 whether the order doesn't exist or belongs to someone else.
    if (!order) throw new NotFoundException('Order not found');
    return this.present(ctx, order, includeCustomer);
  }

  private findOwnOrder(
    ctx: IntegrationKeyContext,
    branchId: string,
    where: { id: string } | { clientRequestId: string },
  ) {
    return this.prisma.order.findFirst({
      where: { ...where, branchId, integrationKeyId: ctx.id },
      include: OWN_ORDER_INCLUDE,
    });
  }

  /**
   * Explicit allow-list of what leaves the API. Deliberately not the raw
   * Prisma row: that carries loyalty/wallet balances, allergy notes, staff
   * ids, table and driver references that a website has no business seeing.
   */
  private present(
    ctx: IntegrationKeyContext,
    order: OwnOrder,
    includeCustomer = false,
  ) {
    const num = (v: Prisma.Decimal | null) => (v ? Number(v) : 0);
    const subtotal = num(order.subtotal);
    const discount =
      num(order.discountAmount) + num(order.loyaltyDiscountAmount);
    const deliveryFee = num(order.deliveryFee);
    const wantsCustomer =
      includeCustomer && ctx.scopes.includes(PERSONAL_DATA_SCOPE);
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status,
      // PENDING until staff accept an online order (unless auto-confirm is on).
      acceptance: order.acceptance,
      kitchenStatus: order.kots.length ? order.kots.map((k) => k.status) : [],
      createdAt: order.createdAt,
      scheduledFor: order.scheduledFor,
      notes: order.notes,
      items: order.items.map((item) => ({
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: Number(item.unitPriceSnapshot),
        lineTotal: Number(item.lineTotal),
        kitchenNote: item.kitchenNote,
        modifiers: item.modifiers.map((m) => ({
          name: m.nameSnapshot,
          priceAdjustment: Number(m.priceAdjSnapshot),
        })),
      })),
      totals: {
        subtotal,
        tax: num(order.taxAmount),
        discount,
        deliveryFee,
        total: Math.round((subtotal - discount + deliveryFee) * 100) / 100,
        paid: order.payments.reduce((sum, p) => sum + Number(p.amount), 0),
      },
      fulfillment:
        order.type === 'DELIVERY'
          ? {
              deliveryStatus: order.deliveryStatus,
              etaAt: order.deliveryEtaAt,
              deliveredAt: order.deliveredAt,
            }
          : null,
      ...(wantsCustomer
        ? {
            customer: {
              name: order.guestName ?? order.customer?.name ?? null,
              phone: order.customer?.phone ?? null,
              email: order.customer?.email ?? null,
            },
            delivery:
              order.type === 'DELIVERY'
                ? {
                    address: order.deliveryAddress,
                    pincode: order.deliveryPincode,
                    phone: order.deliveryPhone,
                  }
                : null,
          }
        : {}),
    };
  }

  async createReservation(
    ctx: IntegrationKeyContext,
    branchId: string,
    dto: CreateIntegrationReservationDto,
  ) {
    await this.assertBranch(ctx, branchId);
    return this.reservations.create(branchId, dto, { fromWebsite: true });
  }

  async getReservation(
    ctx: IntegrationKeyContext,
    branchId: string,
    reservationId: string,
  ) {
    await this.assertBranch(ctx, branchId);
    const reservation = await this.prisma.reservation.findFirst({
      where: { id: reservationId, branchId },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    return reservation;
  }
}
