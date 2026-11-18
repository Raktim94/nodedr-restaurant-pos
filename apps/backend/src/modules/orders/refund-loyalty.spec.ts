/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- hand-built Prisma fakes */
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
  prior?: { reason: string; delta: number }[];
}) {
  const updates: any[] = [];
  const ledger: any[] = [];
  const db: any = {
    customer: {
      findUnique: jest.fn(async () => ({ id: 'c1' })),
      updateMany: jest.fn(async (a: any) => (updates.push(a), { count: 1 })),
      update: jest.fn(async (a: any) => (updates.push(a), {})),
    },
    pointsLedger: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.idempotencyKey === 'earn:o1'
          ? over.earn
            ? { delta: over.earn }
            : null
          : over.redeem
            ? { delta: -over.redeem }
            : null,
      ),
      findMany: jest.fn(async () => over.prior ?? []),
      createMany: jest.fn(async (a: any) => (ledger.push(a), { count: a.data.length })),
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
  alreadyRefunded: 0,
  pointsRedeemed: 40,
};

describe('refund loyalty reversal', () => {
  it('reverses earned points and restores redeemed points on a full refund', async () => {
    const t = tx({ earn: 100, redeem: 40 });
    await (svc() as any).reverseRefundPoints(t.db, base);
    expect(t.updates[0].data.loyaltyPoints).toEqual({ decrement: 100 });
    expect(t.updates[1].data.loyaltyPoints).toEqual({ increment: 40 });
    expect(t.ledger[0].data.map((r: any) => [r.reason, r.delta])).toEqual([
      ['REFUND_EARN_REVERSAL', -100],
      ['REFUND_REDEEM_RESTORATION', 40],
    ]);
    expect(t.ledger[0].data[0].idempotencyKey).toBe('refund:r1:earn');
  });

  it('prorates a partial refund without reversing more than was earned', async () => {
    const first = tx({ earn: 100 });
    await (svc() as any).reverseRefundPoints(first.db, {
      ...base,
      refundId: 'r1',
      refundAmount: 100,
    });
    expect(first.updates[0].data.loyaltyPoints).toEqual({ decrement: 50 });

    // Second half: cumulative 100% earned, minus the 50 already reversed.
    const second = tx({
      earn: 100,
      prior: [{ reason: 'REFUND_EARN_REVERSAL', delta: -50 }],
    });
    await (svc() as any).reverseRefundPoints(second.db, {
      ...base,
      refundId: 'r2',
      refundAmount: 100,
      alreadyRefunded: 100,
    });
    expect(second.updates[0].data.loyaltyPoints).toEqual({ decrement: 50 });
  });

  it('does nothing for a customer with no loyalty history on the order', async () => {
    const t = tx({});
    await (svc() as any).reverseRefundPoints(t.db, {
      ...base,
      pointsRedeemed: 0,
    });
    expect(t.updates).toHaveLength(0);
    expect(t.ledger).toHaveLength(0);
  });
});
