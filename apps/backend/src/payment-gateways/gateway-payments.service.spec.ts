/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- hand-built prisma/adapter fakes */
import {
  GatewayPaymentsService,
  WebhookRejected,
} from './gateway-payments.service';

const fake = {
  key: 'fake',
  fetchStatus: jest.fn(),
  fetchRefundStatus: jest.fn(),
  verifyWebhook: jest.fn(),
  fields: [],
};
jest.mock('./adapters/registry', () => ({
  getAdapter: (k: string | null) => (k === 'fake' ? fake : null),
  listAdapters: () => [],
}));

type Row = Record<string, any>;

function setup(over: Partial<Row> = {}) {
  const pay: Row = {
    id: 'gp1',
    restaurantId: 'r1',
    branchId: 'b1',
    orderId: 'o1',
    provider: 'fake',
    mode: 'LIVE',
    amountMinor: 12345,
    currency: 'INR',
    status: 'CREATED',
    providerRef: 'ref1',
    providerPaymentId: null,
    checkoutUrl: 'https://x',
    note: null,
    createdById: 'u1',
    appliedAt: null,
    createdAt: new Date(),
    ...over,
  };
  const events = new Set<string>();
  const prisma: any = {
    gatewayPayment: {
      findFirst: jest.fn(async () => pay),
      findUnique: jest.fn(async () => pay),
      findUniqueOrThrow: jest.fn(async () => pay),
      update: jest.fn(async ({ data }: Row) => Object.assign(pay, data)),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const ok =
          pay.appliedAt === null && where.status.in.includes(pay.status);
        if (ok) Object.assign(pay, data);
        return { count: ok ? 1 : 0 };
      }),
    },
    paymentGatewayConnection: {
      findUnique: jest.fn(async () => ({ id: 'c1', provider: 'fake' })),
    },
    paymentGatewayCatalogEntry: {
      findFirst: jest.fn(async () => ({ adapter: 'fake' })),
    },
    gatewayWebhookEvent: {
      findUnique: jest.fn(async ({ where }: Row) =>
        events.has(where.provider_mode_eventId.eventId) ? {} : null,
      ),
      findMany: jest.fn(async ({ where }: Row) =>
        (where.eventId?.in ?? []).filter((e: string) => events.has(e)).map((eventId: string) => ({ eventId })),
      ),
      create: jest.fn(async ({ data }: Row) => {
        events.add(data.eventId);
        return data;
      }),
      createMany: jest.fn(async ({ data }: Row) => {
        for (const row of data) events.add(row.eventId);
        return { count: data.length };
      }),
    },
    gatewayRefund: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }: Row) => data),
    },
  };
  prisma.payment = { findFirst: jest.fn(async () => null) };
  const gateways: any = {
    context: jest.fn(() => ({ mode: pay.mode, credentials: {} })),
  };
  const orders: any = {
    checkout: jest.fn(async () => ({})),
    releaseHeldOrder: jest.fn(async () => false),
    previewBill: jest.fn(async () => ({ balanceDue: 123.45 })),
  };
  const svc = new GatewayPaymentsService(prisma, gateways, orders);
  return { svc, pay, orders, prisma, events };
}

const paid = (over: Row = {}) => ({
  state: 'PAID',
  paidMinor: 12345,
  requestedMinor: 12345,
  currency: 'INR',
  reference: 'gp1',
  providerPaymentId: 'pay_9',
  ...over,
});

beforeEach(() => jest.resetAllMocks());

describe('confirming a payment', () => {
  it('settles the order once, with the server-computed amount, from a provider lookup', async () => {
    const { svc, orders, pay } = setup();
    fake.fetchStatus.mockResolvedValue(paid());
    await svc.refresh('gp1');
    expect(orders.checkout).toHaveBeenCalledTimes(1);
    const [, , userId, dto] = orders.checkout.mock.calls[0];
    expect(userId).toBe('u1');
    expect(dto.payments[0].amount).toBe(123.45);
    expect(dto.requestId).toBe('gp1');
    expect(pay.status).toBe('SUCCEEDED');
  });

  it('books no more than the bill owes when a zero-decimal currency rounds the charge up', async () => {
    const { svc, orders } = setup({ currency: 'JPY', amountMinor: 95 });
    orders.previewBill.mockResolvedValue({ balanceDue: 94.5 });
    fake.fetchStatus.mockResolvedValue(
      paid({ paidMinor: 95, currency: 'JPY' }),
    );
    await svc.refresh('gp1');
    const dto = orders.checkout.mock.calls[0][3];
    expect(dto.payments[0].amount).toBe(94.5);
  });

  it('a second look at an already-settled payment never settles again', async () => {
    const { svc, orders } = setup();
    fake.fetchStatus.mockResolvedValue(paid());
    await svc.refresh('gp1');
    await svc.refresh('gp1');
    expect(orders.checkout).toHaveBeenCalledTimes(1);
  });

  it('does not settle when the provider says it is still unpaid', async () => {
    const { svc, orders, pay } = setup();
    fake.fetchStatus.mockResolvedValue(
      paid({ state: 'PENDING', paidMinor: 0 }),
    );
    await svc.refresh('gp1');
    expect(orders.checkout).not.toHaveBeenCalled();
    expect(pay.status).toBe('CREATED');
  });

  it.each([
    ['less than requested', { paidMinor: 100 }],
    ['more than requested', { paidMinor: 99999 }],
    ['another currency', { currency: 'USD' }],
    ['another reference', { reference: 'someone-else' }],
  ])(
    'flags for review instead of settling when the provider reports %s',
    async (_n, o) => {
      const { svc, orders, pay } = setup();
      fake.fetchStatus.mockResolvedValue(paid(o));
      await svc.refresh('gp1');
      expect(orders.checkout).not.toHaveBeenCalled();
      expect(pay.status).toBe('NEEDS_REVIEW');
    },
  );

  it('keeps a received payment visible when the bill will not accept it', async () => {
    const { svc, orders, pay } = setup();
    orders.checkout.mockRejectedValue(
      new Error('Order is not open for checkout'),
    );
    fake.fetchStatus.mockResolvedValue(paid());
    await svc.refresh('gp1');
    expect(pay.status).toBe('NEEDS_REVIEW');
    expect(pay.appliedAt).toBeNull();
    expect(pay.note).toMatch(/could not be settled/);
  });

  it('a TEST payment never marks the order paid and says so', async () => {
    const { svc, orders, pay } = setup({ mode: 'TEST' });
    fake.fetchStatus.mockResolvedValue(paid());
    await svc.refresh('gp1');
    expect(orders.checkout).not.toHaveBeenCalled();
    expect(pay.status).toBe('SUCCEEDED');
    expect(pay.note).toMatch(/no real money moved/i);
  });

  it('survives the provider being unreachable', async () => {
    const { svc, pay } = setup();
    fake.fetchStatus.mockRejectedValue(new Error('boom'));
    await expect(svc.refresh('gp1')).resolves.toMatchObject({
      status: 'CREATED',
    });
    expect(pay.status).toBe('CREATED');
  });
});

describe('webhooks', () => {
  it('rejects an unverifiable delivery without touching any payment', async () => {
    const { svc, orders } = setup();
    fake.verifyWebhook.mockImplementation(() => {
      throw new Error('bad sig');
    });
    await expect(
      svc.webhook('r1', 'fake', 'LIVE', {}, '{}'),
    ).rejects.toBeInstanceOf(WebhookRejected);
    expect(fake.fetchStatus).not.toHaveBeenCalled();
    expect(orders.checkout).not.toHaveBeenCalled();
  });

  it('trusts the provider lookup, not the webhook body, and ignores a replayed event', async () => {
    const { svc, orders } = setup();
    fake.verifyWebhook.mockReturnValue({ eventId: 'e1', providerRef: 'ref1' });
    fake.fetchStatus.mockResolvedValue(paid());
    const first = await svc.webhook(
      'r1',
      'fake',
      'LIVE',
      {},
      '{"status":"paid"}',
    );
    const again = await svc.webhook(
      'r1',
      'fake',
      'LIVE',
      {},
      '{"status":"paid"}',
    );
    expect(first).toEqual({ duplicate: false });
    expect(again).toEqual({ duplicate: true });
    expect(orders.checkout).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge a legacy-only match before refreshing', async () => {
    const { svc, orders, events } = setup();
    events.add('ev_legacy'); // row written by the old deployment
    fake.verifyWebhook.mockReturnValue({
      eventId: 'hash-new',
      legacyEventId: 'ev_legacy',
      providerRef: 'ref1',
    });
    fake.fetchStatus.mockResolvedValue(paid());
    const first = await svc.webhook('r1', 'fake', 'LIVE', {}, '{}');
    expect(first.duplicate).toBe(false);
    expect(fake.fetchStatus).toHaveBeenCalled();
    expect(orders.checkout).toHaveBeenCalledTimes(1);
    // Both keys are recorded after handling, so a later signed delivery dedupes.
    expect(events.has('hash-new')).toBe(true);
    const again = await svc.webhook('r1', 'fake', 'LIVE', {}, '{}');
    expect(again.duplicate).toBe(true);
  });

  it('recognises a legacy event id from before the signed-body dedup switch', async () => {
    const { svc, orders } = setup();
    fake.verifyWebhook.mockReturnValue({
      eventId: 'hash-1',
      legacyEventId: 'ev_legacy',
      providerRef: 'ref1',
    });
    fake.fetchStatus.mockResolvedValue(paid());
    // Simulate a row written by the old deployment.
    const legacy = await svc.webhook('r1', 'fake', 'LIVE', {}, '{}');
    expect(legacy.duplicate).toBe(false);
    // A retry after deployment arrives with the same legacy header but the
    // new hash; it must not settle the order twice.
    const retry = await svc.webhook('r1', 'fake', 'LIVE', {}, '{}');
    expect(retry.duplicate).toBe(true);
    expect(orders.checkout).toHaveBeenCalledTimes(1);
  });

  it('a signed claim of success is worthless if the provider says unpaid', async () => {
    const { svc, orders } = setup();
    fake.verifyWebhook.mockReturnValue({ eventId: 'e2', providerRef: 'ref1' });
    fake.fetchStatus.mockResolvedValue(
      paid({ state: 'PENDING', paidMinor: 0 }),
    );
    await svc.webhook('r1', 'fake', 'LIVE', {}, '{"status":"paid"}');
    expect(orders.checkout).not.toHaveBeenCalled();
  });

  it('does not record the event when handling failed, so the provider retries', async () => {
    const { svc, prisma } = setup();
    fake.verifyWebhook.mockReturnValue({ eventId: 'e3', providerRef: 'ref1' });
    prisma.gatewayPayment.update.mockRejectedValueOnce(new Error('db down'));
    fake.fetchStatus.mockResolvedValue({ ...paid(), state: 'EXPIRED' });
    await expect(svc.webhook('r1', 'fake', 'LIVE', {}, '{}')).rejects.toThrow(
      'db down',
    );
    expect(prisma.gatewayWebhookEvent.createMany).not.toHaveBeenCalled();
  });
});

describe('interrupted settlement', () => {
  it('finalizes a claimed payment whose local Payment already exists', async () => {
    const { svc, pay, prisma, orders } = setup();
    pay.appliedAt = new Date(Date.now() - 3 * 60_000);
    pay.status = 'CREATED';
    prisma.gatewayPayment.updateMany.mockResolvedValue({ count: 0 });
    prisma.payment.findFirst.mockResolvedValue({ id: 'local_payment' });
    await (svc as any).apply(pay, 'pay_9');
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'o1', clientRequestId: 'gp1' },
      }),
    );
    expect(orders.releaseHeldOrder).toHaveBeenCalledWith('b1', 'o1');
    expect(prisma.gatewayPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gp1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
  });

  it('leaves a fresh claim alone and flags an abandoned one for review', async () => {
    const { svc, pay, prisma } = setup();
    pay.appliedAt = new Date();
    pay.status = 'CREATED';
    prisma.gatewayPayment.updateMany.mockResolvedValue({ count: 0 });
    await (svc as any).apply(pay, 'pay_9');
    expect(prisma.gatewayPayment.update).not.toHaveBeenCalled();

    pay.appliedAt = new Date(Date.now() - 3 * 60_000);
    await (svc as any).apply(pay, 'pay_9');
    expect(prisma.gatewayPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'gp1' }),
        data: expect.objectContaining({ status: 'NEEDS_REVIEW' }),
      }),
    );
  });
});

describe('redirect target', () => {
  it('only honours origins from the server allow-list', () => {
    const { svc } = setup();
    process.env.CORS_ORIGIN = 'https://pos.example.com';
    delete process.env.PUBLIC_BASE_URL;
    expect(svc.baseUrl('https://evil.example')).toBe('https://pos.example.com');
    expect(svc.baseUrl('https://pos.example.com/')).toBe(
      'https://pos.example.com',
    );
  });
});

describe('releasing a held table order', () => {
  it('is asked once the payment settles, and a failure there never downgrades the confirmed payment', async () => {
    const { svc, orders, pay } = setup();
    orders.releaseHeldOrder.mockRejectedValue(new Error('kitchen unavailable'));
    fake.fetchStatus.mockResolvedValue(paid());
    await svc.refresh('gp1');
    expect(orders.releaseHeldOrder).toHaveBeenCalledTimes(1);
    expect(pay.status).toBe('SUCCEEDED');
  });
});

describe('stale pending refunds', () => {
  it('verifies with the provider before releasing the hold', async () => {
    const { svc, prisma } = setup();
    const stale = {
      id: 'grStale',
      restaurantId: 'r1',
      gatewayPaymentId: 'gp1',
      provider: 'fake',
      providerRefundId: 're_9',
      refundId: null,
      status: 'PENDING',
      amountMinor: 500,
      currency: 'INR',
      note: null,
      createdAt: new Date(Date.now() - 20 * 60_000),
    };
    prisma.gatewayRefund.findMany.mockResolvedValue([stale]);
    fake.fetchRefundStatus.mockResolvedValue({
      providerRefundId: 're_9',
      state: 'FAILED',
    });
    await svc.refundsNeedingReview('r1');
    expect(fake.fetchRefundStatus).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'LIVE' }),
      're_9',
    );
    expect(prisma.gatewayRefund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grStale' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
