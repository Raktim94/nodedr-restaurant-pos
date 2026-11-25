/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- hand-built Prisma fakes */
import { OrdersService } from './orders.service';

const svc = () =>
  new OrdersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

function tx(over: {
  earn?: number;
  redeem?: number;
  balance?: number;
  prior?: { reason: string; delta: number; customerId?: string }[];
  earnCustomer?: string;
  redeemCustomer?: string;
}) {
  const updates: any[] = [];
  const ledger: any[] = [];
  const db: any = {
    customer: {
      findUnique: jest.fn(async () => ({ loyaltyPoints: over.balance ?? 0 })),
      update: jest.fn(async (a: any) => (updates.push(a), {})),
    },
    pointsLedger: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.idempotencyKey === 'earn:o1')
          return over.earn
            ? { delta: over.earn, customerId: over.earnCustomer ?? 'c1' }
            : null;
        return over.redeem
          ? { delta: -over.redeem, customerId: over.redeemCustomer ?? 'c1' }
          : null;
      }),
      findMany: jest.fn(async () => over.prior ?? []),
      createMany: jest.fn(
        async (a: any) => (ledger.push(a), { count: a.data.length }),
      ),
    },
  };
  return { db, updates, ledger };
}

const base = {
  branchId: 'b1',
  orderId: 'o1',
  customerId: 'c1',
  refundId: 'r1',
  refundAmount: 200,
  totalAmount: 200,
  moneyPaid: 200,
  alreadyRefunded: 0,
  pointsRedeemed: 40,
};

const run = (t: ReturnType<typeof tx>, over: Partial<typeof base> = {}) =>
  (svc() as any).reverseRefundPoints(t.db, { ...base, ...over });

describe('refund loyalty reversal', () => {
  it('reverses earned points and restores redeemed points on a full refund', async () => {
    const t = tx({ earn: 100, redeem: 40, balance: 200 });
    await run(t);
    expect(t.updates.map((u) => u.data.loyaltyPoints)).toEqual([
      { increment: 40 },
      { decrement: 100 },
    ]);
    expect(t.ledger[0].data.map((r: any) => [r.reason, r.delta])).toEqual([
      ['REFUND_EARN_REVERSAL', -100],
      ['REFUND_REDEEM_RESTORATION', 40],
    ]);
    expect(t.ledger[0].data[0].idempotencyKey).toBe('refund:r1:earn');
  });

  it('prorates successive partial refunds without exceeding the original points', async () => {
    const first = tx({ earn: 100, redeem: 40, balance: 200 });
    await run(first, { refundId: 'r1', refundAmount: 100 });
    expect(first.updates.map((u) => u.data.loyaltyPoints)).toEqual([
      { increment: 20 },
      { decrement: 50 },
    ]);

    // The second half sees both ledger rows written by the first call.
    const second = tx({
      earn: 100,
      redeem: 40,
      balance: 170,
      prior: [
        { reason: 'REFUND_EARN_REVERSAL', delta: -50 },
        { reason: 'REFUND_REDEEM_RESTORATION', delta: 20 },
      ],
    });
    await run(second, {
      refundId: 'r2',
      refundAmount: 100,
      alreadyRefunded: 100,
    });
    expect(second.updates.map((u) => u.data.loyaltyPoints)).toEqual([
      { increment: 20 },
      { decrement: 50 },
    ]);
  });

  it('uses integer cents so a 0.10 + 0.70 refund reaches the full boundary', async () => {
    const t = tx({
      earn: 10,
      balance: 50,
      prior: [{ reason: 'REFUND_EARN_REVERSAL', delta: -1 }],
    });
    await run(t, {
      refundId: 'r2',
      refundAmount: 0.7,
      totalAmount: 0.8,
      alreadyRefunded: 0.1,
      pointsRedeemed: 0,
    });
    expect(t.updates[0].data.loyaltyPoints).toEqual({ decrement: 9 });
  });

  it('returns all redeemed points when the money portion is fully refunded', async () => {
    // 100 bill = 60 money + 40 points. A full money refund of 60 must return
    // all 40 points, not 24 (the old totalAmount-based share).
    const t = tx({ earn: 0, redeem: 40, balance: 0 });
    await run(t, {
      refundAmount: 60,
      totalAmount: 100,
      moneyPaid: 60,
      pointsRedeemed: 40,
    });
    expect(t.updates.map((u) => u.data.loyaltyPoints)).toEqual([
      { increment: 40 },
    ]);
  });

  it('lets restored points cover an earn reversal on the same customer', async () => {
    const t = tx({ earn: 10, redeem: 40, balance: 0 });
    await run(t, {
      refundAmount: 200,
      totalAmount: 200,
      pointsRedeemed: 40,
    });
    expect(t.updates.map((u) => u.data.loyaltyPoints)).toEqual([
      { increment: 40 },
      { decrement: 10 },
    ]);
    expect(
      t.ledger[0].data.some(
        (r: any) => r.reason === 'REFUND_EARN_REVERSAL_PENDING',
      ),
    ).toBe(false);
  });

  it('records an uncollectable reversal instead of failing the refund', async () => {
    const t = tx({ earn: 100, balance: 0 });
    await expect(
      run(t, { refundAmount: 200, totalAmount: 200, pointsRedeemed: 0 }),
    ).resolves.toBeUndefined();
    expect(t.updates).toHaveLength(0);
    expect(t.ledger[0].data).toEqual([
      expect.objectContaining({
        reason: 'REFUND_EARN_REVERSAL_PENDING',
        delta: -100,
      }),
    ]);
  });

  it('does nothing for a customer with no loyalty history on the order', async () => {
    const t = tx({ balance: 50 });
    await run(t, { pointsRedeemed: 0 });
    expect(t.updates).toHaveLength(0);
    expect(t.ledger).toHaveLength(0);
  });
});
