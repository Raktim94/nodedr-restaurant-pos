/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- hand-built prisma/adapter fakes */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GatewayError } from './adapters/adapter';
import { GatewayPaymentsService } from './gateway-payments.service';

const fake = { key: 'fake', name: 'Fake', fields: [], refund: jest.fn() };
jest.mock('./adapters/registry', () => ({
  getAdapter: (k: string | null) => (k === 'fake' ? fake : null),
  listAdapters: () => [],
}));

type Row = Record<string, any>;

function setup(
  over: Row = {},
  held = 0,
  priorRefunded = 0,
  orderTotal = 123.45,
) {
  const pay: Row = {
    id: 'gp1',
    restaurantId: 'r1',
    branchId: 'b1',
    orderId: 'o1',
    provider: 'fake',
    mode: 'LIVE',
    amountMinor: 12345,
    currency: 'INR',
    status: 'SUCCEEDED',
    providerPaymentId: 'pay_9',
    appliedAt: new Date(),
    createdById: 'u1',
    ...over,
  };
  const refunds: Row[] = [];
  const tx: any = {
    gatewayPayment: { update: jest.fn(async () => pay) },
    gatewayRefund: {
      aggregate: jest.fn(async () => ({ _sum: { amountMinor: held } })),
      create: jest.fn(async ({ data }: Row) => {
        const r = { id: 'gr1', ...data };
        refunds.push(r);
        return r;
      }),
    },
  };
  const prisma: any = {
    gatewayPayment: { findFirst: jest.fn(async () => pay) },
    paymentGatewayConnection: {
      findUnique: jest.fn(async () => ({ id: 'c1', provider: 'fake' })),
    },
    paymentGatewayCatalogEntry: {
      findFirst: jest.fn(async () => ({ adapter: 'fake' })),
    },
    order: {
      findFirst: jest.fn(async () => ({
        totalAmount: orderTotal,
        status: 'PAID',
      })),
    },
    refund: {
      aggregate: jest.fn(async () => ({ _sum: { amount: priorRefunded } })),
    },
    gatewayRefund: {
      update: jest.fn(async ({ data }: Row) =>
        Object.assign(refunds[0] ?? {}, data),
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const gateways: any = {
    context: jest.fn(() => ({ mode: 'LIVE', credentials: {} })),
  };
  const orders: any = { refund: jest.fn(async () => ({ id: 'ref_local' })) };
  const svc = new GatewayPaymentsService(prisma, gateways, orders);
  return { svc, prisma, orders, refunds };
}
const go = (s: ReturnType<typeof setup>, amount = 50) =>
  s.svc.refund('r1', 'b1', 'gp1', 'u2', { amount, reason: 'cold food' });

beforeEach(() => jest.resetAllMocks());

describe('refunding through the gateway', () => {
  it('sends the refund once, then records it locally with the provider named', async () => {
    const s = setup();
    fake.refund.mockResolvedValue({ providerRefundId: 're_1', state: 'DONE' });
    await expect(go(s)).resolves.toMatchObject({
      ok: true,
      providerRefundId: 're_1',
    });
    expect(fake.refund).toHaveBeenCalledTimes(1);
    expect(fake.refund.mock.calls[0][1]).toMatchObject({
      providerPaymentId: 'pay_9',
      amountMinor: 5000,
      currency: 'INR',
      reference: 'gr1',
    });
    expect(s.orders.refund).toHaveBeenCalledWith(
      'b1',
      'o1',
      'u2',
      expect.objectContaining({ amount: 50, method: 'OTHER' }),
    );
    expect(
      s.prisma.gatewayRefund.update.mock.calls.at(-1)[0].data,
    ).toMatchObject({ status: 'SUCCEEDED', refundId: 'ref_local' });
  });

  it('a definite provider rejection records nothing locally', async () => {
    const s = setup();
    fake.refund.mockRejectedValue(
      new GatewayError('insufficient balance', 400),
    );
    await expect(go(s)).rejects.toBeInstanceOf(BadRequestException);
    expect(s.orders.refund).not.toHaveBeenCalled();
    expect(s.prisma.gatewayRefund.update.mock.calls[0][0].data.status).toBe(
      'FAILED',
    );
  });

  it('a timeout is flagged for review, never retried, and nothing is recorded locally', async () => {
    const s = setup();
    fake.refund.mockRejectedValue(
      new GatewayError('The payment provider could not be reached'),
    );
    await expect(go(s)).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.refund).toHaveBeenCalledTimes(1);
    expect(s.orders.refund).not.toHaveBeenCalled();
    expect(s.prisma.gatewayRefund.update.mock.calls[0][0].data.status).toBe(
      'NEEDS_REVIEW',
    );
  });

  it('if the provider refunded but the local record fails, it is flagged with the provider id', async () => {
    const s = setup();
    fake.refund.mockResolvedValue({
      providerRefundId: 're_2',
      state: 'PENDING',
    });
    s.orders.refund.mockRejectedValue(new Error('db down'));
    await expect(go(s)).rejects.toBeInstanceOf(ConflictException);
    expect(
      s.prisma.gatewayRefund.update.mock.calls.at(-1)[0].data,
    ).toMatchObject({ status: 'NEEDS_REVIEW', providerRefundId: 're_2' });
  });

  it('refuses a test payment, an unsettled payment and a gateway without refund support', async () => {
    await expect(go(setup({ mode: 'TEST' }))).rejects.toThrow(/test payment/i);
    await expect(go(setup({ appliedAt: null }))).rejects.toThrow(
      /settled online payment/,
    );
    await expect(go(setup({ providerPaymentId: null }))).rejects.toThrow(
      /settled online payment/,
    );
    const noRefund = setup();
    delete (fake as any).refund;
    await expect(go(noRefund)).rejects.toThrow(
      /cannot be sent from OrderRestro/,
    );
    (fake as any).refund = jest.fn();
    expect(fake.refund).not.toHaveBeenCalled();
  });

  it('cannot refund more than the payment, counting refunds already reserved', async () => {
    const s = setup({}, 10000); // 100.00 already held of 123.45
    await expect(go(s, 50)).rejects.toThrow(/can still be refunded/);
    expect(fake.refund).not.toHaveBeenCalled();
  });

  it('cannot refund more than the order still allows, before touching the provider', async () => {
    const s = setup({}, 0, 100); // only 23.45 left on the order
    await expect(go(s, 50)).rejects.toThrow(/remains refundable/);
    expect(fake.refund).not.toHaveBeenCalled();
  });
});
