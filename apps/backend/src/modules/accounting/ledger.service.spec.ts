/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- hand-built Prisma/jest mocks */
import { LedgerService, parseStatement } from './ledger.service';

describe('LedgerService balance sheet', () => {
  it('includes paid payroll at net pay and excludes tips', async () => {
    const prisma: any = {
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1000 } }),
      },
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      expense: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      supplierPayment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
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
      ingredient: { findMany: jest.fn().mockResolvedValue([]) },
      supplierInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      giftCard: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new LedgerService(prisma as never);
    const r = await svc.balanceSheet('b1', '2026-10-31');
    expect(prisma.payrollRun.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['FINALIZED', 'PAID'],
    });
    expect(r.assets[0].amount).toBe(910);
  });
});

describe('parseStatement', () => {
  it('reads a signed amount column', () => {
    const { rows } = parseStatement(
      'Date,Description,Amount\n2026-10-02,Milk supplier,-1200.50\n2026-10-03,UPI settlement,"4,500.00"',
    );
    expect(rows).toEqual([
      {
        postedOn: '2026-10-02',
        description: 'Milk supplier',
        reference: '',
        amount: -1200.5,
      },
      {
        postedOn: '2026-10-03',
        description: 'UPI settlement',
        reference: '',
        amount: 4500,
      },
    ]);
  });

  it('reads debit/credit columns and dd/mm/yyyy dates', () => {
    const { rows } = parseStatement(
      'Txn Date,Narration,Ref No,Withdrawal,Deposit\n05/10/2026,Rent,UTR1,15000,\n06/10/2026,Cash deposit,,,2000',
    );
    expect(rows.map((r) => [r.postedOn, r.amount, r.reference])).toEqual([
      ['2026-10-05', -15000, 'UTR1'],
      ['2026-10-06', 2000, ''],
    ]);
  });

  it('skips unreadable rows and reports their line numbers', () => {
    const { rows, skipped } = parseStatement(
      'Date,Description,Amount\nnot a date,x,5\n2026-10-01,ok,5',
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([2]);
  });

  it('rejects a statement without the needed columns', () => {
    expect(() => parseStatement('a,b\n1,2')).toThrow();
  });
});
