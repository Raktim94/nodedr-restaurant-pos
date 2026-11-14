/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- hand-built prisma/adapter fakes */
import {
  GatewayPaymentsService,
  WebhookRejected,
} from './gateway-payments.service';

const fake = {
  key: 'fake',
  fetchStatus: jest.fn(),
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
      create: jest.fn(async ({ data }: Row) => {
        events.add(data.eventId);
        return data;
      }),
    },
  };
  const gateways: any = {
    context: jest.fn(() => ({ mode: pay.mode, credentials: {} })),
  };
  const orders: any = {
    checkout: jest.fn(async () => ({})),
    releaseHeldOrder: jest.fn(async () => false),
  };
  const svc = new GatewayPaymentsService(prisma, gateways, orders);
  return { svc, pay, orders, prisma };
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
    expect(prisma.gatewayWebhookEvent.create).not.toHaveBeenCalled();
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
