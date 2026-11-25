/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- hand-built Prisma fakes */
import { VerifactuService } from './verifactu.service';

function order(over: Record<string, number> = {}) {
  return {
    id: 'o1',
    orderNumber: 'ORD-1',
    subtotal: 100,
    discountAmount: 0,
    deliveryFee: 0,
    loyaltyDiscountAmount: 20,
    totalAmount: 80,
    tipAmount: 0,
    items: [{ lineTotal: 100, taxRateSnapshot: 21 }],
    branch: {
      id: 'b1',
      branchId: 'b1',
      country: 'ES',
      taxId: 'B123',
      restaurantId: 'r1',
      restaurant: { name: 'R', legalName: 'R SL' },
      verifactuSettings: {
        branchId: 'b1',
        enabled: true,
        environment: 'TEST',
        seriesPrefix: 'A',
        installationNumber: '1',
        nextNumber: 1,
        nextRefundNumber: 1,
      },
    },
    ...over,
  };
}

function svc() {
  const s: any = Object.create(VerifactuService.prototype);
  s.problems = () => [];
  s.append = jest.fn(async (_tx: any, args: any) => args);
  return s;
}

function txFor(o: any, findResults: unknown[] = [null, null]) {
  const findFirst = jest.fn();
  for (const r of findResults) findFirst.mockResolvedValueOnce(r);
  return {
    order: { findUniqueOrThrow: jest.fn(async () => o) },
    verifactuRecord: { findFirst },
    verifactuSettings: {
      update: jest.fn(async () => ({ nextNumber: 1, nextRefundNumber: 1 })),
    },
  };
}

describe('VERI*FACTU taxable base', () => {
  it('F2 keeps loyalty-funded value in the taxable base', async () => {
    const s = svc();
    const tx = txFor(order());
    await s.recordPaidOrder(tx, 'o1');
    // 100 food, 20 paid with points: still a 100 taxable sale, not 80.
    expect(s.append.mock.calls[0][1].targetCents).toBe(10000);
  });

  it('F2 excludes tips but includes delivery', async () => {
    const s = svc();
    await s.recordPaidOrder(
      txFor(order({ tipAmount: 10, deliveryFee: 5, totalAmount: 95 })),
      'o1',
    );
    expect(s.append.mock.calls[0][1].targetCents).toBe(10500);
  });

  it('R5 reverses the full taxable base when the money portion is fully refunded', async () => {
    const s = svc();
    const original = { invoiceNumber: 'A-000001', issueDate: '2026-11-24' };
    const tx = txFor(order(), [original, null]);
    // 100 bill = 60 money + 40 points; the money portion is the full refund.
    await s.recordRefund(tx, 'o1', 'r1', 60);
    expect(s.append.mock.calls[0][1].targetCents).toBe(-10000);
  });

  it('R5 pro-rates a partial refund and ignores a duplicate call', async () => {
    const s = svc();
    const original = { invoiceNumber: 'A-000001', issueDate: '2026-11-24' };
    await s.recordRefund(txFor(order(), [original, null]), 'o1', 'r1', 30);
    expect(s.append.mock.calls[0][1].targetCents).toBe(-5000);

    const repeat = svc();
    const tx = txFor(order(), [original, { invoiceNumber: 'R1-000001' }]);
    await repeat.recordRefund(tx, 'o1', 'r1', 80);
    expect(repeat.append).not.toHaveBeenCalled();
  });
});
