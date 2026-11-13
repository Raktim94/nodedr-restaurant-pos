import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CartItemDto } from '@nodedr-restaurant/types';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { GatewayPaymentsService } from '../../payment-gateways/gateway-payments.service';
import { PaymentGatewaysService } from '../../payment-gateways/payment-gateways.service';
import { OrdersService } from '../orders/orders.service';
import { RatingsService } from '../ratings/ratings.service';
import { TableSessionsService } from '../tables/table-sessions.service';

@Injectable()
export class PublicMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly gateways: PaymentGatewaysService,
    private readonly gatewayPayments: GatewayPaymentsService,
    private readonly sessions: TableSessionsService,
    private readonly ratings: RatingsService,
  ) {}

  private async resolveTable(qrToken: string) {
    const table = await this.prisma.table.findUnique({
      where: { qrToken },
      include: { floor: { include: { branch: { include: { restaurant: true } } } } },
    });
    if (!table) throw new NotFoundException('This QR code is not recognized');
    return table;
  }

  async getMenuByQrToken(qrToken: string) {
    const table = await this.resolveTable(qrToken);
    const branch = table.floor.branch;
    const categories = await this.menuCategoriesForBranch(branch.id);
    // Cash at the register is always possible; paying on the phone only when a gateway is switched on.
    const online = !!(await this.gateways.active(branch.restaurantId));
    return {
      branchName: branch.name,
      tableName: table.name ?? `Table ${table.number}`,
      categories,
      payments: { cash: true, online },
      // The table QR only says WHICH table. Ordering needs the live table code that staff open (see TableSessionsService).
      session: { required: branch.restaurant.requireTableSession },
    };
  }

  /** Customer-visible menu tree, shared by the table-QR page and the kiosk. */
  menuCategoriesForBranch(branchId: string) {
    return this.prisma.menuCategory.findMany({
      where: { branchId, isActive: true, showOnWebsite: true },
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
  }

  async createOrder(
    qrToken: string,
    items: CartItemDto[],
    guestName: string,
    opts: { payment?: 'CASH' | 'ONLINE'; idempotencyKey?: string; sessionToken?: string } = {},
  ) {
    const table = await this.resolveTable(qrToken);
    const branchId = table.floor.branchId;
    // Dine-in ordering needs a live session grant; a photographed or shared static QR is not enough.
    if (table.floor.branch.restaurant.requireTableSession) await this.sessions.assertGrant(table.id, opts.sessionToken);

    // The same basket sent again (double tap, flaky connection) returns the same order.
    if (opts.idempotencyKey) {
      const seen = await this.prisma.publicOrderKey.findUnique({ where: { branchId_key: { branchId, key: opts.idempotencyKey } } });
      if (seen) return { ...(await this.ordersService.getOrder(branchId, seen.orderId)), duplicate: true, ratingToken: this.ratings.issue(seen.orderId) };
    }
    if (opts.payment === 'ONLINE' && !(await this.gateways.active(table.floor.branch.restaurantId))) {
      throw new BadRequestException('Paying on your phone is not available here. Please choose cash at the register.');
    }

    const result = await this.createOrAdd(table, branchId, items, guestName, opts.payment);
    if (opts.idempotencyKey) {
      try {
        await this.prisma.publicOrderKey.create({ data: { branchId, key: opts.idempotencyKey, orderId: result.id } });
      } catch (e) {
        // Two identical requests raced: the other one already recorded it.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    // The way to rate THIS order later, made by the server and handed only to the phone that placed it.
    return { ...result, ratingToken: this.ratings.issue(result.id) };
  }

  private async createOrAdd(
    table: Awaited<ReturnType<PublicMenuService['resolveTable']>>,
    branchId: string,
    items: CartItemDto[],
    guestName: string,
    payment?: 'CASH' | 'ONLINE',
  ) {
    // A guest who already ordered once this visit and scans again to add more should land on the same
    // tab, not open a second order for the table; mirrors how staff add a round from the POS.
    const openOrder = await this.prisma.order.findFirst({ where: { branchId, tableId: table.id, status: 'OPEN' } });
    if (openOrder) {
      return this.ordersService.addItems(branchId, openOrder.id, items, { enforceModifierLimits: true, websiteOnly: true });
    }

    // A guest scanning a QR code has no staff account, but Order.createdById is a required FK: attribute the
    // order to whoever is on the floor for this table, falling back to any staff member of the branch.
    const createdById =
      table.assignedWaiterId ??
      (await this.prisma.userBranch.findFirst({ where: { branchId }, orderBy: { userId: 'asc' } }))?.userId;
    if (!createdById) throw new NotFoundException('This branch has no staff to receive the order');

    return this.ordersService.createOrder(
      branchId,
      createdById,
      { type: 'QR_ORDER', tableId: table.id, guestName, items },
      // ONLINE: the kitchen waits for the confirmed payment. CASH: the kitchen starts now and the money is taken
      // at the register by staff; the order stays unpaid until they record it.
      { channel: 'ONLINE', payIntent: payment, heldForPayment: payment === 'ONLINE' },
    );
  }

  private async tableOrder(qrToken: string, orderId: string) {
    const table = await this.resolveTable(qrToken);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tableId: table.id, status: 'OPEN' } });
    if (!order) throw new NotFoundException('That order is not open at this table');
    return { table, order };
  }

  /** The guest trades the staff's code for a grant, or the page asks whether its saved grant is still good. */
  async joinSession(qrToken: string, code: string) {
    const table = await this.resolveTable(qrToken);
    return this.sessions.join(table.id, code);
  }

  async sessionState(qrToken: string, token?: string) {
    const table = await this.resolveTable(qrToken);
    return { required: table.floor.branch.restaurant.requireTableSession, ...(await this.sessions.publicState(table.id, token)) };
  }

  /** Start (or restart after a failure) the guest's online payment. The amount always comes from the server bill. */
  async payOnline(qrToken: string, orderId: string, origin?: string) {
    const { table, order } = await this.tableOrder(qrToken, orderId);
    if (order.payIntent !== 'ONLINE') throw new BadRequestException('This order was not placed for online payment');
    const pay = await this.gatewayPayments.create(table.floor.branch.restaurantId, order.branchId, order.id, order.createdById, { origin });
    return pay;
  }

  /** The guest could not pay online (or changed their mind) and will pay at the register: send it to the kitchen. */
  async switchToCash(qrToken: string, orderId: string) {
    const { order } = await this.tableOrder(qrToken, orderId);
    if (order.payIntent !== 'ONLINE') throw new ConflictException('This order is already set to pay at the register');
    // An online payment that is mid-flight must be allowed to finish or fail first.
    const inflight = await this.prisma.gatewayPayment.findFirst({ where: { orderId, status: 'CREATED', createdAt: { gt: new Date(Date.now() - 2 * 60_000) } } });
    if (inflight) throw new ConflictException('A payment was just started. Wait a minute for it to finish, or try again.');
    await this.prisma.order.update({ where: { id: orderId }, data: { payIntent: 'CASH' } });
    await this.ordersService.releaseHeldOrder(order.branchId, orderId);
    return { ok: true };
  }

  /** Live status of the table's current tab, for the guest's QR page. */
  async getStatus(qrToken: string) {
    const table = await this.resolveTable(qrToken);
    const order = await this.prisma.order.findFirst({
      where: {
        tableId: table.id,
        OR: [{ status: { in: ['OPEN', 'BILLED'] } }, { status: 'PAID', createdAt: { gt: new Date(Date.now() - 3 * 3_600_000) } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        acceptance: true,
        payIntent: true,
        heldForPayment: true,
        totalAmount: true,
        items: { select: { id: true, nameSnapshot: true, quantity: true, status: true } },
        kots: { select: { status: true } },
      },
    });
    const requests = await this.prisma.tableRequest.findMany({ where: { tableId: table.id, resolvedAt: null }, select: { type: true } });
    if (!order) return { order: null, openRequests: requests.map((r) => r.type) };

    // One honest line for the guest, derived only from what is true on the server.
    const k = order.kots.map((x) => x.status).filter((s) => s !== 'CANCELLED' && s !== 'REJECTED');
    const kitchen = order.heldForPayment
      ? 'WAITING_PAYMENT'
      : k.length === 0
        ? 'SENT'
        : k.every((s) => s === 'SERVED')
          ? 'SERVED'
          : k.every((s) => s === 'READY' || s === 'SERVED')
            ? 'READY'
            : k.some((s) => s === 'PREPARING' || s === 'ACCEPTED')
              ? 'PREPARING'
              : 'NEW';
    const lastPay = await this.prisma.gatewayPayment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' }, select: { status: true } });
    const call = await this.prisma.buzzerCall.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' }, select: { state: true } });
    const { kots: _k, ...rest } = order;
    return {
      order: {
        ...rest,
        paid: order.status === 'PAID',
        kitchen,
        // FAILED / EXPIRED tell the page to offer "try again" or "pay at the register"; never "paid".
        lastPayment: lastPay?.status ?? null,
        paged: !!call && ['PENDING', 'SENT'].includes(call.state),
      },
      openRequests: requests.map((r) => r.type),
    };
  }

  /** "Call waiter" / "Bring the bill". One open request per type per table. */
  async createRequest(qrToken: string, type: 'WAITER' | 'BILL', sessionToken?: string) {
    const table = await this.resolveTable(qrToken);
    if (table.floor.branch.restaurant.requireTableSession) await this.sessions.assertGrant(table.id, sessionToken);
    const branchId = table.floor.branchId;
    const existing = await this.prisma.tableRequest.findFirst({
      where: { tableId: table.id, type, resolvedAt: null },
    });
    if (existing) return { ok: true, alreadyRequested: true };

    const request = await this.prisma.tableRequest.create({
      data: { branchId, tableId: table.id, type },
    });
    this.realtime.emitToBranch(branchId, 'table.request', { id: request.id });
    const tableName = table.name ?? `Table ${table.number}`;
    try {
      await this.notifications.notifyByPermission(branchId, 'tables.manage', {
        type: type === 'BILL' ? 'table.bill' : 'table.waiter',
        title:
          type === 'BILL'
            ? `${tableName} wants the bill`
            : `${tableName} needs a waiter`,
        body: 'Requested from the table QR code',
        entity: 'Table',
        entityId: table.id,
      });
    } catch {
      // Best-effort: the request row and live event already exist.
    }
    return { ok: true, alreadyRequested: false };
  }
}
