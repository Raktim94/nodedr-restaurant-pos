import { createHash } from 'crypto';
import {
  GatewayError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type GatewayContext,
  type PaymentGatewayAdapter,
  type RefundInput,
  type RefundResult,
  type RemoteStatus,
  type TestOutcome,
  type VerifiedWebhook,
} from './adapter';
import { gatewayFetch } from './http';
import { hmacHex, safeEqual } from './signature';

// Stripe Checkout (hosted page). Docs:
//   https://docs.stripe.com/api/checkout/sessions/create
//   https://docs.stripe.com/webhooks#verify-manually
const API = 'https://api.stripe.com';
const TOLERANCE_SECONDS = 300;

const form = (pairs: [string, string][]) =>
  pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

const auth = (c: GatewayContext) => ({
  Authorization: `Bearer ${c.credentials.secretKey}`,
});

const keyPrefix =
  (kind: string) =>
  (v: string, mode: 'TEST' | 'LIVE'): string | null => {
    const want = mode === 'TEST' ? '_test_' : '_live_';
    if (!/^(sk|rk)_(test|live)_/.test(v) && kind === 'secret') {
      return 'Use a Stripe secret or restricted key (starts with sk_ or rk_)';
    }
    return kind === 'secret' && !v.includes(want)
      ? `This is not a ${mode === 'TEST' ? 'test' : 'live'}-mode key`
      : null;
  };

export const stripeAdapter: PaymentGatewayAdapter = {
  key: 'stripe',
  name: 'Stripe',
  docsUrl: 'https://docs.stripe.com/payments/checkout',
  integration: 'Stripe-hosted Checkout page',
  limitations: [
    'Refunds go back to the original card through the Stripe API (Live payments only).',
    'Only successful, fully paid Checkout Sessions settle a bill.',
  ],
  fields: [
    {
      key: 'secretKey',
      label: 'Secret or restricted API key',
      secret: true,
      required: true,
      help: 'Dashboard → Developers → API keys. A restricted key needs write access to Checkout Sessions.',
      validate: keyPrefix('secret'),
    },
    {
      key: 'webhookSecret',
      label: 'Webhook signing secret',
      secret: true,
      required: true,
      help: 'Starts with whsec_. Create a webhook endpoint for checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed and checkout.session.expired.',
      validate: (v) =>
        v.startsWith('whsec_') ? null : 'A signing secret starts with whsec_',
    },
  ],

  async testConnection(ctx): Promise<TestOutcome> {
    try {
      await gatewayFetch(`${API}/v1/checkout/sessions?limit=1`, {
        headers: auth(ctx),
      });
      return { ok: true, message: 'Stripe accepted the API key.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async createPayment(
    ctx,
    i: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const body = form([
      ['mode', 'payment'],
      ['success_url', i.returnUrl],
      ['cancel_url', i.returnUrl],
      ['client_reference_id', i.reference],
      ['metadata[gatewayPaymentId]', i.reference],
      ['payment_intent_data[metadata][gatewayPaymentId]', i.reference],
      ['line_items[0][quantity]', '1'],
      ['line_items[0][price_data][currency]', i.currency.toLowerCase()],
      ['line_items[0][price_data][unit_amount]', String(i.amountMinor)],
      ['line_items[0][price_data][product_data][name]', i.description],
    ]);
    const r = await gatewayFetch<{ id: string; url: string | null }>(
      `${API}/v1/checkout/sessions`,
      {
        method: 'POST',
        headers: {
          ...auth(ctx),
          'Content-Type': 'application/x-www-form-urlencoded',
          // A retry of the same attempt returns the same session, never a second one.
          'Idempotency-Key': i.reference,
        },
        body,
      },
    );
    if (!r.id || !r.url)
      throw new GatewayError('Stripe returned no checkout URL');
    return { providerRef: r.id, checkoutUrl: r.url };
  },

  async fetchStatus(ctx, providerRef): Promise<RemoteStatus> {
    const s = await gatewayFetch<{
      id: string;
      status: 'open' | 'complete' | 'expired';
      payment_status: 'paid' | 'unpaid' | 'no_payment_required';
      amount_total: number | null;
      currency: string | null;
      client_reference_id: string | null;
      payment_intent: string | { id: string } | null;
    }>(`${API}/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, {
      headers: auth(ctx),
    });
    const total = s.amount_total ?? 0;
    const pi =
      typeof s.payment_intent === 'string'
        ? s.payment_intent
        : s.payment_intent?.id;
    return {
      // `no_payment_required` is a zero-total session: not money received.
      state:
        s.payment_status === 'paid'
          ? 'PAID'
          : s.status === 'expired'
            ? 'EXPIRED'
            : 'PENDING',
      paidMinor: s.payment_status === 'paid' ? total : 0,
      requestedMinor: total,
      currency: (s.currency ?? '').toUpperCase(),
      reference: s.client_reference_id,
      providerPaymentId: pi ?? null,
    };
  },

  async refund(ctx, i: RefundInput): Promise<RefundResult> {
    const r = await gatewayFetch<{ id: string; status: string }>(
      `${API}/v1/refunds`,
      {
        method: 'POST',
        headers: {
          ...auth(ctx),
          'Content-Type': 'application/x-www-form-urlencoded',
          // Same key on a retry returns the same refund, never a second one.
          'Idempotency-Key': `refund-${i.reference}`,
        },
        body: form([
          ['payment_intent', i.providerPaymentId],
          ['amount', String(i.amountMinor)],
          ['metadata[gatewayRefundId]', i.reference],
        ]),
      },
    );
    if (r.status === 'failed' || r.status === 'canceled') {
      throw new GatewayError(
        `Stripe could not refund this payment (${r.status})`,
        400,
      );
    }
    return {
      providerRefundId: r.id,
      state: r.status === 'succeeded' ? 'DONE' : 'PENDING',
    };
  },

  verifyWebhook(ctx, headers, rawBody): VerifiedWebhook {
    const secret = ctx.credentials.webhookSecret;
    const header = headers['stripe-signature'];
    if (!secret || !header) throw new GatewayError('Missing webhook signature');
    let t = '';
    const v1: string[] = [];
    for (const part of header.split(',')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k === 't') t = v;
      else if (k === 'v1') v1.push(v); // v0 and any other scheme are ignored
    }
    const ts = Number(t);
    if (!ts || v1.length === 0)
      throw new GatewayError('Malformed webhook signature');
    if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
      throw new GatewayError('Webhook timestamp outside the allowed window');
    }
    const expected = hmacHex(secret, `${t}.${rawBody}`);
    if (!v1.some((sig) => safeEqual(sig, expected))) {
      throw new GatewayError('Webhook signature mismatch');
    }
    const ev = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: { id?: string; object?: string } };
    };
    const obj = ev.data?.object;
    const about =
      ev.type?.startsWith('checkout.session.') &&
      obj?.object === 'checkout.session';
    return {
      eventId: ev.id ?? createHash('sha256').update(rawBody).digest('hex'),
      providerRef: about && obj?.id ? obj.id : null,
    };
  },
};
