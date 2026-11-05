import { createHash } from 'crypto';
import {
  GatewayError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type GatewayContext,
  type PaymentGatewayAdapter,
  type RemoteStatus,
  type TestOutcome,
  type VerifiedWebhook,
} from './adapter';
import { gatewayFetch } from './http';
import { fromMinor, toMinor } from '../money';
import { hmacBase64, safeEqual } from './signature';

// Cashfree Payment Links. Docs:
//   https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create-payment-link
//   https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/webhooks
// Sandbox and production are different hosts, chosen by the mode.
const API_VERSION = '2026-01-01';
const base = (c: GatewayContext) =>
  c.mode === 'TEST'
    ? 'https://sandbox.cashfree.com/pg'
    : 'https://api.cashfree.com/pg';

const headers = (c: GatewayContext, extra: Record<string, string> = {}) => ({
  'x-api-version': API_VERSION,
  'x-client-id': c.credentials.clientId,
  'x-client-secret': c.credentials.clientSecret,
  ...extra,
});

interface CfLink {
  link_id: string;
  link_status: string;
  link_amount: number;
  link_amount_paid?: number | null;
  link_currency: string;
}

export const cashfreeAdapter: PaymentGatewayAdapter = {
  key: 'cashfree',
  name: 'Cashfree Payments',
  docsUrl:
    'https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create-payment-link',
  integration: 'Cashfree-hosted Payment Link (UPI, cards, netbanking, wallets)',
  requiresCustomerPhone: true,
  limitations: [
    'Cashfree requires the payer phone number to create a link.',
    "Webhook body parsing follows Cashfree's documented schema but has not been exercised against a live Cashfree account; the payment is always confirmed by a server-side status lookup, and the return page also triggers that lookup.",
    'Refunds are made in the Cashfree dashboard; OrderRestro cannot send them (the link-order refund API was not verified).',
  ],
  fields: [
    {
      key: 'clientId',
      label: 'App ID (client ID)',
      secret: false,
      required: true,
      help: 'Cashfree dashboard → Developers → API keys. Use the Test (sandbox) keys in Test mode.',
    },
    {
      key: 'clientSecret',
      label: 'Secret key',
      secret: true,
      required: true,
      help: 'Also used to verify webhook signatures.',
    },
  ],

  async testConnection(ctx): Promise<TestOutcome> {
    try {
      // A link id that cannot exist: 404 means the credentials were accepted
      // and the id simply was not found; 401/403 means they were not.
      await gatewayFetch(`${base(ctx)}/links/orderrestro-connection-check`, {
        headers: headers(ctx),
      });
      return { ok: true, message: 'Cashfree accepted the credentials.' };
    } catch (e) {
      const status = (e as GatewayError).status;
      if (status === 404) {
        return { ok: true, message: 'Cashfree accepted the credentials.' };
      }
      return { ok: false, message: (e as Error).message };
    }
  },

  async createPayment(
    ctx,
    i: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    if (!i.customer?.phone) {
      throw new GatewayError('Cashfree needs the customer phone number');
    }
    const r = await gatewayFetch<{ link_url: string; link_id: string }>(
      `${base(ctx)}/links`,
      {
        method: 'POST',
        headers: headers(ctx, {
          'Content-Type': 'application/json',
          'x-idempotency-key': cashfreeIdempotencyKey(i.reference),
        }),
        body: JSON.stringify({
          link_id: i.reference,
          link_amount: fromMinor(i.amountMinor, i.currency),
          link_currency: i.currency.toUpperCase(),
          link_purpose: i.description.slice(0, 500),
          link_partial_payments: false,
          customer_details: {
            customer_phone: i.customer.phone,
            ...(i.customer.name ? { customer_name: i.customer.name } : {}),
            ...(i.customer.email ? { customer_email: i.customer.email } : {}),
          },
          link_notify: { send_sms: false, send_email: false },
          link_meta: { return_url: i.returnUrl, notify_url: i.notifyUrl },
        }),
      },
    );
    if (!r.link_url)
      throw new GatewayError('Cashfree returned no payment link');
    return { providerRef: r.link_id ?? i.reference, checkoutUrl: r.link_url };
  },

  async fetchStatus(ctx, providerRef): Promise<RemoteStatus> {
    const l = await gatewayFetch<CfLink>(
      `${base(ctx)}/links/${encodeURIComponent(providerRef)}`,
      { headers: headers(ctx) },
    );
    const requested = toMinor(l.link_amount, l.link_currency);
    const paid = toMinor(l.link_amount_paid ?? 0, l.link_currency);
    const status = l.link_status.toUpperCase();
    return {
      state:
        status === 'PAID'
          ? 'PAID'
          : status === 'EXPIRED' || status === 'CANCELLED'
            ? 'EXPIRED'
            : 'PENDING',
      paidMinor: paid,
      requestedMinor: requested,
      currency: l.link_currency.toUpperCase(),
      reference: l.link_id,
      providerPaymentId: null,
    };
  },

  verifyWebhook(ctx, hdrs, rawBody): VerifiedWebhook {
    const secret = ctx.credentials.clientSecret;
    const sig = hdrs['x-webhook-signature'];
    const ts = hdrs['x-webhook-timestamp'];
    if (!secret || !sig || !ts)
      throw new GatewayError('Missing webhook signature');
    // Base64(HMAC-SHA256(timestamp + rawBody)), key = the PG secret key.
    if (!safeEqual(sig, hmacBase64(secret, ts + rawBody))) {
      throw new GatewayError('Webhook signature mismatch');
    }
    return {
      // Cashfree documents no event id, so the signed delivery itself is the id.
      eventId: createHash('sha256')
        .update(ts + rawBody)
        .digest('hex'),
      providerRef: extractLinkId(rawBody),
    };
  },
};

// x-idempotency-key must be a UUID; derive a stable one from our reference.
export function cashfreeIdempotencyKey(reference: string): string {
  const h = createHash('sha256').update(reference).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Link webhooks arrive as JSON or form data depending on version; find link_id in either. */
export function extractLinkId(raw: string): string | null {
  const dig = (o: unknown): string | null => {
    if (!o || typeof o !== 'object') return null;
    const rec = o as Record<string, unknown>;
    if (typeof rec.link_id === 'string') return rec.link_id;
    for (const v of Object.values(rec)) {
      const f = dig(v);
      if (f) return f;
    }
    return null;
  };
  try {
    return dig(JSON.parse(raw));
  } catch {
    /* not JSON */
  }
  const form = new URLSearchParams(raw);
  const direct = form.get('link_id');
  if (direct) return direct;
  for (const v of form.values()) {
    try {
      const f = dig(JSON.parse(v));
      if (f) return f;
    } catch {
      /* not JSON */
    }
  }
  return null;
}
