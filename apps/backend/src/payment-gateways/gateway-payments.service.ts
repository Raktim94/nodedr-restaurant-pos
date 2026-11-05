import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { GatewayPayment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../modules/orders/orders.service';
import {
  GatewayError,
  type GatewayModeKey,
  type RemoteStatus,
  type VerifiedWebhook,
} from './adapters/adapter';
import { getAdapter } from './adapters/registry';
import { fromMinor, toMinor } from './money';
import { PaymentGatewaysService } from './payment-gateways.service';

// A link already made for this exact bill is reused for this long, so a
// double-tap or a second cashier never creates a second chargeable link.
const REUSE_WINDOW_MS = 30 * 60_000;
// The public return page may be refreshed; never hit the provider more than once in this window per payment.
const MIN_REFRESH_GAP_MS = 2_000;

export class WebhookRejected extends Error {}

@Injectable()
export class GatewayPaymentsService {
  private readonly logger = new Logger(GatewayPaymentsService.name);
  private readonly lastFetch = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewaysService,
    private readonly orders: OrdersService,
  ) {}

  // ----- URLs ----------------------------------------------------------------

  /** Public base URL for redirects and webhooks. A caller-supplied origin is only honoured if it is in CORS_ORIGIN. */
  baseUrl(requestOrigin?: string): string {
    const allowed = (process.env.CORS_ORIGIN ?? 'http://localhost:1995')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);
    const fixed = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
    const o = requestOrigin?.replace(/\/$/, '');
    if (o && allowed.includes(o)) return o;
    return fixed || allowed[0];
  }

  // ----- create --------------------------------------------------------------

  async create(
    restaurantId: string,
    branchId: string,
    orderId: string,
    userId: string,
    input: { customerPhone?: string; customerName?: string; origin?: string },
  ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    const active = await this.gateways.active(restaurantId);
    if (!active) {
      throw new BadRequestException(
        'No online payment gateway is switched on. Set one up in Settings → Payment gateways.',
      );
    }
    const { connection, adapter } = active;
    const mode: GatewayModeKey = connection.mode;
    const keys = mode === 'TEST' ? connection.testKeys : connection.liveKeys;
    if (
      !adapter.fields
        .filter((f) => f.required)
        .every((f) => keys.includes(f.key))
    ) {
      throw new BadRequestException(
        `The ${mode === 'TEST' ? 'Test' : 'Live'} credentials are incomplete`,
      );
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, branchId },
      select: { id: true, status: true, acceptance: true, orderNumber: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Order is not open for payment');
    }
    if (order.acceptance === 'PENDING') {
      throw new ConflictException('Accept this order before taking payment');
    }

    // The amount is ours, from the server-side bill. The client never supplies it.
    const bill = await this.orders.previewBill(branchId, orderId, {});
    const balance = Number(bill.balanceDue);
    if (!(balance > 0))
      throw new BadRequestException('Nothing is due on this order');
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { currency: true, name: true },
    });
    const currency = restaurant.currency.toUpperCase();
    const amountMinor = toMinor(balance, currency);
    if (amountMinor <= 0)
      throw new BadRequestException('Nothing is due on this order');

    if (adapter.requiresCustomerPhone && !input.customerPhone) {
      throw new BadRequestException(
        `${adapter.name} needs the customer's phone number`,
      );
    }

    // Reuse an open link for the same bill instead of creating a second one.
    const reusable = await this.prisma.gatewayPayment.findFirst({
      where: {
        orderId,
        provider: connection.provider,
        mode,
        status: 'CREATED',
        amountMinor,
        currency,
        checkoutUrl: { not: null },
        createdAt: { gt: new Date(Date.now() - REUSE_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable) return this.present(reusable);

    const row = await this.prisma.gatewayPayment.create({
      data: {
        restaurantId,
        branchId,
        orderId,
        provider: connection.provider,
        mode,
        amountMinor,
        currency,
        createdById: userId,
      },
    });
    const base = this.baseUrl(input.origin);
    try {
      const ctx = this.gateways.context(restaurantId, connection, mode);
      const r = await adapter.createPayment(ctx, {
        amountMinor,
        currency,
        reference: row.id,
        description: `${restaurant.name} - order ${order.orderNumber}`,
        returnUrl: `${base}/pay/return?gp=${row.id}`,
        notifyUrl: `${base}/api/v1/payment-gateways/webhook/${restaurantId}/${connection.provider}/${mode}`,
        customer: { name: input.customerName, phone: input.customerPhone },
      });
      const saved = await this.prisma.gatewayPayment.update({
        where: { id: row.id },
        data: { providerRef: r.providerRef, checkoutUrl: r.checkoutUrl },
      });
      return this.present(saved);
    } catch (e) {
      const msg =
        e instanceof GatewayError
          ? e.message
          : 'Could not create the payment link';
      await this.prisma.gatewayPayment.update({
        where: { id: row.id },
        data: { status: 'FAILED', note: msg.slice(0, 300) },
      });
      this.logger.warn(
        `Payment link failed (${connection.provider}/${mode}): ${msg}`,
      );
      throw new BadRequestException(msg);
    }
  }

  // ----- confirm ---------------------------------------------------------------

  /**
   * Re-reads the payment from the provider with the merchant's secret and acts
   * on THAT, never on what a browser or webhook body claimed.
   */
  async refresh(
    id: string,
    scope?: { restaurantId: string; branchId?: string },
  ) {
    let p = await this.prisma.gatewayPayment.findFirst({
      where: {
        id,
        ...(scope ? { restaurantId: scope.restaurantId } : {}),
        ...(scope?.branchId ? { branchId: scope.branchId } : {}),
      },
    });
    if (!p) throw new NotFoundException('Payment not found');
    if (
      !p.providerRef ||
      (p.status !== 'CREATED' && p.status !== 'NEEDS_REVIEW')
    ) {
      return this.present(p);
    }
    const last = this.lastFetch.get(p.id) ?? 0;
    if (Date.now() - last < MIN_REFRESH_GAP_MS) return this.present(p);
    this.lastFetch.set(p.id, Date.now());
    if (this.lastFetch.size > 5000) this.lastFetch.clear();

    const conn = await this.prisma.paymentGatewayConnection.findUnique({
      where: {
        restaurantId_provider: {
          restaurantId: p.restaurantId,
          provider: p.provider,
        },
      },
    });
    const entry = await this.prisma.paymentGatewayCatalogEntry.findFirst({
      where: {
        key: p.provider,
        OR: [{ restaurantId: p.restaurantId }, { restaurantId: null }],
      },
      orderBy: { restaurantId: 'desc' },
    });
    const adapter = getAdapter(entry?.adapter);
    if (!conn || !adapter) return this.present(p);

    let remote: RemoteStatus;
    try {
      remote = await adapter.fetchStatus(
        this.gateways.context(p.restaurantId, conn, p.mode),
        p.providerRef,
      );
    } catch (e) {
      this.logger.warn(
        `Status lookup failed for ${p.id}: ${(e as Error).message}`,
      );
      return this.present(p);
    }

    if (remote.state === 'EXPIRED') {
      p = await this.prisma.gatewayPayment.update({
        where: { id: p.id },
        data: { status: 'EXPIRED' },
      });
      return this.present(p);
    }
    if (remote.state !== 'PAID') return this.present(p);

    // Paid: it must be exactly what we asked for, in the currency we asked for.
    const mismatch =
      remote.currency !== p.currency ||
      remote.paidMinor !== p.amountMinor ||
      (remote.reference != null && remote.reference !== p.id);
    if (mismatch) {
      p = await this.prisma.gatewayPayment.update({
        where: { id: p.id },
        data: {
          status: 'NEEDS_REVIEW',
          providerPaymentId: remote.providerPaymentId ?? p.providerPaymentId,
          note: 'The provider reports an amount, currency or reference different from what was requested. Check it in the provider dashboard.',
        },
      });
      return this.present(p);
    }
    return this.present(await this.apply(p, remote.providerPaymentId ?? null));
  }

  /** Settles the order once, however many times this is reached. */
  private async apply(p: GatewayPayment, providerPaymentId: string | null) {
    if (p.mode === 'TEST') {
      // A test payment proves the wiring but moved no money, so it must not
      // mark a real order as paid.
      return this.prisma.gatewayPayment.update({
        where: { id: p.id },
        data: {
          status: 'SUCCEEDED',
          providerPaymentId,
          note: 'Test payment: no real money moved and the order was left unpaid.',
        },
      });
    }
    // Atomic claim: only one caller (webhook, return page, poll) gets past this.
    const claimed = await this.prisma.gatewayPayment.updateMany({
      where: {
        id: p.id,
        appliedAt: null,
        status: { in: ['CREATED', 'NEEDS_REVIEW'] },
      },
      data: { appliedAt: new Date(), providerPaymentId },
    });
    if (claimed.count === 0) {
      return this.prisma.gatewayPayment.findUniqueOrThrow({
        where: { id: p.id },
      });
    }
    try {
      await this.orders.checkout(p.branchId, p.orderId, p.createdById, {
        payments: [
          {
            method: 'OTHER',
            amount: fromMinor(p.amountMinor, p.currency),
            reference:
              `${p.provider}:${providerPaymentId ?? p.providerRef}`.slice(
                0,
                120,
              ),
          },
        ],
        allowPartial: true,
        requestId: p.id,
      });
      return await this.prisma.gatewayPayment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', note: null },
      });
    } catch (e) {
      // Money was taken but the bill would not accept it (changed, cancelled,
      // already paid). Never drop it silently: release the claim and flag it.
      this.logger.error(
        `Could not settle order ${p.orderId} for ${p.id}: ${(e as Error).message}`,
      );
      return this.prisma.gatewayPayment.update({
        where: { id: p.id },
        data: {
          status: 'NEEDS_REVIEW',
          appliedAt: null,
          note: `Payment received but the order could not be settled: ${(e as Error).message}`.slice(
            0,
            300,
          ),
        },
      });
    }
  }

  // ----- webhook -----------------------------------------------------------------

  async webhook(
    restaurantId: string,
    provider: string,
    mode: GatewayModeKey,
    headers: Record<string, string | undefined>,
    rawBody: string,
  ) {
    const conn = await this.prisma.paymentGatewayConnection.findUnique({
      where: { restaurantId_provider: { restaurantId, provider } },
    });
    const entry = await this.prisma.paymentGatewayCatalogEntry.findFirst({
      where: { key: provider, OR: [{ restaurantId }, { restaurantId: null }] },
      orderBy: { restaurantId: 'desc' },
    });
    const adapter = getAdapter(entry?.adapter);
    // One generic answer for every kind of failure, so the endpoint tells a caller nothing.
    if (!conn || !adapter) throw new WebhookRejected();

    let verified: VerifiedWebhook;
    try {
      verified = adapter.verifyWebhook(
        this.gateways.context(restaurantId, conn, mode),
        headers,
        rawBody,
      );
    } catch {
      throw new WebhookRejected();
    }

    const seen = await this.prisma.gatewayWebhookEvent.findUnique({
      where: {
        provider_mode_eventId: { provider, mode, eventId: verified.eventId },
      },
    });
    if (seen) return { duplicate: true };

    if (verified.providerRef) {
      const p = await this.prisma.gatewayPayment.findFirst({
        where: {
          restaurantId,
          provider,
          mode,
          providerRef: verified.providerRef,
        },
      });
      // Bypass the polling throttle: a signed event is a reason to look now.
      if (p) {
        this.lastFetch.delete(p.id);
        await this.refresh(p.id);
      }
    }
    // Recorded only after successful handling, so a failure is retried by the provider.
    await this.prisma.gatewayWebhookEvent
      .create({ data: { provider, mode, eventId: verified.eventId } })
      .catch(() => undefined);
    return { duplicate: false };
  }

  // ----- reads -------------------------------------------------------------------

  async forOrder(restaurantId: string, branchId: string, orderId: string) {
    const rows = await this.prisma.gatewayPayment.findMany({
      where: { restaurantId, branchId, orderId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.present(r));
  }

  /** What a cashier needs to know to offer online payment, and nothing secret. */
  async activeSummary(restaurantId: string) {
    const a = await this.gateways.active(restaurantId);
    if (!a) return null;
    const keys =
      a.connection.mode === 'TEST'
        ? a.connection.testKeys
        : a.connection.liveKeys;
    const ready = a.adapter.fields
      .filter((f) => f.required)
      .every((f) => keys.includes(f.key));
    if (!ready) return null;
    return {
      provider: a.connection.provider,
      name: a.adapter.name,
      mode: a.connection.mode,
      requiresCustomerPhone: !!a.adapter.requiresCustomerPhone,
    };
  }

  /** Latest payments across the restaurant, so setup and flagged items can be inspected. */
  async recent(restaurantId: string) {
    const rows = await this.prisma.gatewayPayment.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.present(r));
  }

  /** Everything the payer-facing return page may learn: a status word, nothing else. */
  async publicStatus(id: string) {
    const p = await this.refresh(id).catch(() => null);
    if (!p) throw new NotFoundException('Payment not found');
    return { status: p.status, test: p.mode === 'TEST' };
  }

  private present(p: GatewayPayment) {
    return {
      id: p.id,
      orderId: p.orderId,
      provider: p.provider,
      mode: p.mode,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
      checkoutUrl: p.checkoutUrl,
      note: p.note,
      createdAt: p.createdAt,
    };
  }
}
