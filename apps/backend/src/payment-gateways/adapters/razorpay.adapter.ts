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
import { basicAuth, gatewayFetch } from './http';
import { hmacHex, safeEqual } from './signature';

// Razorpay Payment Links (hosted page). Docs:
//   https://razorpay.com/docs/api/payments/payment-links/create-standard
//   https://razorpay.com/docs/webhooks/validate-test/
// The same host serves test and live; the key id (rzp_test_ / rzp_live_)
// decides which, which is why the key is checked against the chosen mode.
const API = 'https://api.razorpay.com';

const auth = (c: GatewayContext) =>
  basicAuth(c.credentials.keyId, c.credentials.keySecret);

interface RzpLink {
  id: string;
  status: 'created' | 'partially_paid' | 'expired' | 'cancelled' | 'paid';
  amount: number;
  amount_paid: number;
  currency: string;
  reference_id?: string | null;
  payments?: { payment_id?: string; status?: string }[] | null;
}

export const razorpayAdapter: PaymentGatewayAdapter = {
  key: 'razorpay',
  name: 'Razorpay',
  docsUrl:
    'https://razorpay.com/docs/api/payments/payment-links/create-standard',
  integration: 'Razorpay-hosted Payment Link (UPI, cards, netbanking, wallets)',
  limitations: [
    'Refunds go back to the original payment method through the Razorpay API (Live payments only). Razorpay has no idempotency key, so a refund request is never retried automatically.',
    'Partial payments are disabled on the links this app creates.',
  ],
  fields: [
    {
      key: 'keyId',
      label: 'Key ID',
      secret: false,
      required: true,
      help: 'Dashboard → Account & Settings → API keys. Starts with rzp_test_ or rzp_live_.',
      validate: (v, mode) =>
        v.startsWith(mode === 'TEST' ? 'rzp_test_' : 'rzp_live_')
          ? null
          : `This is not a ${mode === 'TEST' ? 'test' : 'live'}-mode key id`,
    },
    {
      key: 'keySecret',
      label: 'Key Secret',
      secret: true,
      required: true,
      help: 'Shown once when the key is generated.',
    },
    {
      key: 'webhookSecret',
      label: 'Webhook secret',
      secret: true,
      required: true,
      help: 'Set when you add the webhook. Subscribe to payment_link.paid, payment_link.partially_paid, payment_link.expired and payment_link.cancelled.',
    },
  ],

  async testConnection(ctx): Promise<TestOutcome> {
    try {
      await gatewayFetch(`${API}/v1/payment_links?count=1`, {
        headers: { Authorization: auth(ctx) },
      });
      return { ok: true, message: 'Razorpay accepted the API keys.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async createPayment(
    ctx,
    i: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const r = await gatewayFetch<{ id: string; short_url: string }>(
      `${API}/v1/payment_links`,
      {
        method: 'POST',
        headers: {
          Authorization: auth(ctx),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: i.amountMinor,
          currency: i.currency.toUpperCase(),
          accept_partial: false,
          // Max 40 chars and unique per link; our ids are 25.
          reference_id: i.reference,
          description: i.description.slice(0, 2000),
          callback_url: i.returnUrl,
          callback_method: 'get',
          reminder_enable: false,
          notify: { sms: false, email: false },
          notes: { gatewayPaymentId: i.reference },
        }),
      },
    );
    if (!r.id || !r.short_url)
      throw new GatewayError('Razorpay returned no payment link');
    return { providerRef: r.id, checkoutUrl: r.short_url };
  },

  async fetchStatus(ctx, providerRef): Promise<RemoteStatus> {
    const l = await gatewayFetch<RzpLink>(
      `${API}/v1/payment_links/${encodeURIComponent(providerRef)}`,
      { headers: { Authorization: auth(ctx) } },
    );
    const state =
      l.status === 'paid'
        ? 'PAID'
        : l.status === 'expired' || l.status === 'cancelled'
          ? 'EXPIRED'
          : 'PENDING';
    return {
      state,
      paidMinor: l.amount_paid ?? 0,
      requestedMinor: l.amount,
      currency: (l.currency ?? '').toUpperCase(),
      reference: l.reference_id ?? null,
      providerPaymentId:
        l.payments?.find((p) => p.payment_id)?.payment_id ?? null,
    };
  },

  async refund(ctx, i: RefundInput): Promise<RefundResult> {
    const r = await gatewayFetch<{ id: string; status: string }>(
      `${API}/v1/payments/${encodeURIComponent(i.providerPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: auth(ctx),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: i.amountMinor,
          speed: 'normal',
          receipt: i.reference,
          notes: { gatewayRefundId: i.reference },
        }),
      },
    );
    if (r.status === 'failed') {
      throw new GatewayError('Razorpay could not refund this payment', 400);
    }
    return {
      providerRefundId: r.id,
      state: r.status === 'processed' ? 'DONE' : 'PENDING',
    };
  },

  verifyWebhook(ctx, headers, rawBody): VerifiedWebhook {
    const secret = ctx.credentials.webhookSecret;
    const sig = headers['x-razorpay-signature'];
    if (!secret || !sig) throw new GatewayError('Missing webhook signature');
    // HMAC-SHA256 of the raw body, hex, compared in constant time.
    if (!safeEqual(sig, hmacHex(secret, rawBody))) {
      throw new GatewayError('Webhook signature mismatch');
    }
    const ev = JSON.parse(rawBody) as {
      event?: string;
      payload?: { payment_link?: { entity?: { id?: string } } };
    };
    return {
      eventId:
        headers['x-razorpay-event-id'] ??
        createHash('sha256').update(rawBody).digest('hex'),
      providerRef: ev.event?.startsWith('payment_link.')
        ? (ev.payload?.payment_link?.entity?.id ?? null)
        : null,
    };
  },
};
