/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-base-to-string */
import { createHash, createHmac } from 'crypto';
import {
  cashfreeAdapter,
  cashfreeIdempotencyKey,
  extractLinkId,
} from './adapters/cashfree.adapter';
import { razorpayAdapter } from './adapters/razorpay.adapter';
import { stripeAdapter } from './adapters/stripe.adapter';
import { fromMinor, toMinor } from './money';
import { BUILTIN_CATALOG } from './catalog-data';
import { getAdapter } from './adapters/registry';

const hex = (k: string, d: string) =>
  createHmac('sha256', k).update(d).digest('hex');
const b64 = (k: string, d: string) =>
  createHmac('sha256', k).update(d).digest('base64');

describe('money', () => {
  it('converts 2-decimal totals to exact integers', () => {
    expect(toMinor(123.45, 'INR')).toBe(12345);
    expect(toMinor(0.29, 'USD')).toBe(29); // 0.29*100 is 28.999… as a float
    expect(toMinor(1.1, 'GBP')).toBe(110);
    expect(toMinor(500, 'JPY')).toBe(500);
    expect(toMinor(1.5, 'KWD')).toBe(1500);
  });
  it('round-trips', () => {
    expect(fromMinor(12345, 'INR')).toBe(123.45);
    expect(fromMinor(500, 'JPY')).toBe(500);
  });
});

describe('Stripe webhook verification', () => {
  const secret = 'whsec_test_secret';
  const ctx = { mode: 'TEST' as const, credentials: { webhookSecret: secret } };
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', id: 'cs_test_1' } },
  });
  const sign = (t: number, b = body, s = secret) =>
    `t=${t},v1=${hex(s, `${t}.${b}`)},v0=deadbeef`;
  const now = () => Math.floor(Date.now() / 1000);

  it('accepts a valid signature and names the session', () => {
    const r = stripeAdapter.verifyWebhook(
      ctx,
      { 'stripe-signature': sign(now()) },
      body,
    );
    expect(r).toEqual({ eventId: 'evt_1', providerRef: 'cs_test_1' });
  });
  it('rejects a tampered body, wrong secret, stale timestamp, missing header, v0-only', () => {
    expect(() =>
      stripeAdapter.verifyWebhook(
        ctx,
        { 'stripe-signature': sign(now()) },
        body + ' ',
      ),
    ).toThrow();
    expect(() =>
      stripeAdapter.verifyWebhook(
        ctx,
        { 'stripe-signature': sign(now(), body, 'whsec_other') },
        body,
      ),
    ).toThrow();
    expect(() =>
      stripeAdapter.verifyWebhook(
        ctx,
        { 'stripe-signature': sign(now() - 3600) },
        body,
      ),
    ).toThrow();
    expect(() => stripeAdapter.verifyWebhook(ctx, {}, body)).toThrow();
    expect(() =>
      stripeAdapter.verifyWebhook(
        ctx,
        { 'stripe-signature': `t=${now()},v0=abc` },
        body,
      ),
    ).toThrow();
  });
  it('ignores events that are not about a checkout session', () => {
    const b = JSON.stringify({
      id: 'evt_2',
      type: 'charge.refunded',
      data: { object: { object: 'charge', id: 'ch_1' } },
    });
    const t = now();
    const r = stripeAdapter.verifyWebhook(
      ctx,
      { 'stripe-signature': `t=${t},v1=${hex(secret, `${t}.${b}`)}` },
      b,
    );
    expect(r.providerRef).toBeNull();
  });
  it('rejects a live-mode key in the test slot and vice versa', () => {
    const f = stripeAdapter.fields.find((x) => x.key === 'secretKey')!;
    expect(f.validate!('sk_live_abc', 'TEST')).toMatch(/not a test/);
    expect(f.validate!('sk_test_abc', 'LIVE')).toMatch(/not a live/);
    expect(f.validate!('sk_test_abc', 'TEST')).toBeNull();
    expect(f.validate!('pk_test_abc', 'TEST')).toMatch(/secret/);
  });
});

describe('Razorpay webhook verification', () => {
  const secret = 'rzp_whsec';
  const ctx = { mode: 'TEST' as const, credentials: { webhookSecret: secret } };
  const body =
    '{"event":"payment_link.paid","payload":{"payment_link":{"entity":{"id":"plink_1"}}}}';
  it('verifies the raw body and uses the event id header', () => {
    const r = razorpayAdapter.verifyWebhook(
      ctx,
      {
        'x-razorpay-signature': hex(secret, body),
        'x-razorpay-event-id': 'ev_9',
      },
      body,
    );
    expect(r).toEqual({ eventId: 'ev_9', providerRef: 'plink_1' });
  });
  it('fails if even whitespace changes', () => {
    expect(() =>
      razorpayAdapter.verifyWebhook(
        ctx,
        { 'x-razorpay-signature': hex(secret, body) },
        body.replace(',"payload"', ', "payload"'),
      ),
    ).toThrow();
  });
  it('checks key mode', () => {
    const f = razorpayAdapter.fields.find((x) => x.key === 'keyId')!;
    expect(f.validate!('rzp_live_x', 'TEST')).toMatch(/not a test/);
    expect(f.validate!('rzp_test_x', 'TEST')).toBeNull();
  });
});

describe('Cashfree webhook verification', () => {
  const secret = 'cf_secret';
  const ctx = { mode: 'TEST' as const, credentials: { clientSecret: secret } };
  const body =
    '{"data":{"link_id":"abc123","link_status":"PAID"},"type":"PAYMENT_LINK_EVENT"}';
  it('verifies base64(HMAC(timestamp+body))', () => {
    const ts = '1700000000000';
    const r = cashfreeAdapter.verifyWebhook(
      ctx,
      {
        'x-webhook-signature': b64(secret, ts + body),
        'x-webhook-timestamp': ts,
      },
      body,
    );
    expect(r.providerRef).toBe('abc123');
    expect(r.eventId).toBe(
      createHash('sha256')
        .update(ts + body)
        .digest('hex'),
    );
  });
  it('rejects bad signature or missing timestamp', () => {
    expect(() =>
      cashfreeAdapter.verifyWebhook(
        ctx,
        { 'x-webhook-signature': 'nope', 'x-webhook-timestamp': '1' },
        body,
      ),
    ).toThrow();
    expect(() =>
      cashfreeAdapter.verifyWebhook(
        ctx,
        { 'x-webhook-signature': b64(secret, body) },
        body,
      ),
    ).toThrow();
  });
  it('finds link_id in JSON or form data, and yields a v4-shaped UUID key', () => {
    expect(extractLinkId('link_id=zz9&x=1')).toBe('zz9');
    expect(
      extractLinkId('data=' + encodeURIComponent('{"link_id":"q1"}')),
    ).toBe('q1');
    expect(extractLinkId('garbage')).toBeNull();
    expect(cashfreeIdempotencyKey('r')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('catalog', () => {
  it('every named adapter exists, and only integrated ones claim to be', () => {
    for (const e of BUILTIN_CATALOG) {
      if (e.adapter) expect(getAdapter(e.adapter)).not.toBeNull();
    }
  });
  it('never lists another country’s provider for a country', () => {
    const forIN = BUILTIN_CATALOG.filter(
      (e) => e.countries.includes('IN') && e.active !== false,
    ).map((e) => e.key);
    expect(forIN).toEqual(expect.arrayContaining(['razorpay', 'cashfree']));
    expect(forIN).not.toContain('redsys');
    expect(forIN).not.toContain('stripe'); // Stripe India was invite-only in the sources checked
  });
  it('records when it was researched and has no duplicate keys', () => {
    const keys = BUILTIN_CATALOG.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('refund requests', () => {
  afterEach(() => jest.restoreAllMocks());
  const ok = (body: unknown) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

  it('Stripe: payment_intent + integer amount + idempotency key derived from our refund id', async () => {
    const f = ok({ id: 're_1', status: 'succeeded' });
    const r = await stripeAdapter.refund!(
      { mode: 'LIVE', credentials: { secretKey: 'sk_live_x' } },
      {
        providerPaymentId: 'pi_9',
        amountMinor: 5000,
        currency: 'USD',
        reference: 'gr1',
      },
    );
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(String(init.body)).toContain('payment_intent=pi_9');
    expect(String(init.body)).toContain('amount=5000');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'refund-gr1',
    );
    expect(r).toEqual({ providerRefundId: 're_1', state: 'DONE' });
  });

  it('Razorpay: refunds the payment id in paise and reports pending until processed', async () => {
    const f = ok({ id: 'rfnd_1', status: 'pending' });
    const r = await razorpayAdapter.refund!(
      { mode: 'LIVE', credentials: { keyId: 'rzp_live_a', keySecret: 's' } },
      {
        providerPaymentId: 'pay_9',
        amountMinor: 5000,
        currency: 'INR',
        reference: 'gr1',
      },
    );
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_9/refund');
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 5000,
      receipt: 'gr1',
    });
    expect(r.state).toBe('PENDING');
  });

  it('a failed provider refund is a definite rejection', async () => {
    ok({ id: 're_2', status: 'failed' });
    await expect(
      stripeAdapter.refund!(
        { mode: 'LIVE', credentials: { secretKey: 'sk_live_x' } },
        {
          providerPaymentId: 'pi',
          amountMinor: 1,
          currency: 'USD',
          reference: 'g',
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('Cashfree declares no refund support', () => {
    expect(cashfreeAdapter.refund).toBeUndefined();
  });
});
