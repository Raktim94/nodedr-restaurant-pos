/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { AccountingService } from './accounting.service';

// Guards the bug where report windows were cut at UTC midnight instead of
// the restaurant's local midnight.
describe('AccountingService day windows', () => {
  function setup() {
    const prisma = {
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      expense: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
    };
    const time = { tzForBranch: jest.fn().mockResolvedValue('Asia/Kolkata') };
    return {
      svc: new AccountingService(prisma as never, time as never),
      prisma,
    };
  }

  it('cuts the cash-close window at local (IST) midnight', async () => {
    const { svc, prisma } = setup();
    await svc.closingPreview('b1', '2026-10-04');
    const range = prisma.payment.aggregate.mock.calls[0][0].where.createdAt;
    expect(range.gte.toISOString()).toBe('2026-10-03T18:30:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-10-04T18:30:00.000Z');
    expect(prisma.refund.aggregate.mock.calls[0][0].where.createdAt).toEqual(
      range,
    );
  });
});

describe('AccountingService reports', () => {
  function setup() {
    const prisma = {
      order: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { totalAmount: 1000, tipAmount: 0, taxAmount: 0 },
          _count: { _all: 1 },
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'o1',
            totalAmount: 100,
            subtotal: 100,
            discountAmount: 0,
            loyaltyDiscountAmount: 0,
            items: [{ lineTotal: 100, taxRateSnapshot: 18 }],
          },
        ]),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        groupBy: jest.fn().mockResolvedValue([
          { orderId: 'o1', _sum: { amount: 50 } },
        ]),
      },
      expense: {
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(async (a: any) => a.data),
      },
      cashClosing: { findUnique: jest.fn().mockResolvedValue(null) },
      payrollRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            lines: [
              {
                netPay: 100,
                tipShare: 10,
                basePay: 80,
                unpaidLeaveDeduction: 0,
              },
            ],
          },
        ]),
      },
    };
    const time = { tzForBranch: jest.fn().mockResolvedValue('Asia/Kolkata') };
    return {
      svc: new AccountingService(prisma as never, time as never),
      prisma,
    };
  }

  it('keeps paid payroll in P&L and uses net pay net of tips', async () => {
    const { svc, prisma } = setup();
    const r = await svc.profitAndLoss('b1', '2026-10-01', '2026-10-31');
    expect(prisma.payrollRun.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['FINALIZED', 'PAID'],
    });
    expect(r.payrollCost).toBe(90);
  });

  it('reduces GST taxable value and tax by refunded amounts', async () => {
    const { svc } = setup();
    const r = await svc.gstReport('b1', '2026-10-01', '2026-10-31');
    expect(r.totalTaxable).toBe(42.37);
    expect(r.totalTax).toBe(7.63);
  });

  it('refuses a cash expense on an already closed day', async () => {
    const { svc, prisma } = setup();
    prisma.cashClosing.findUnique.mockResolvedValue({ id: 'close1' });
    await expect(
      svc.createExpense('b1', 'u1', {
        spentOn: '2026-10-04',
        category: 'Other',
        amount: 500,
        note: null,
        paidFromCash: true,
      } as never),
    ).rejects.toThrow(/already closed/);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });
});
