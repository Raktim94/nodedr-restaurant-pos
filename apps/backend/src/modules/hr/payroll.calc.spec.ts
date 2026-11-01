import { computePayroll, daysInclusive, daysInMonthOf } from './payroll.calc';

describe('payroll maths', () => {
  it('counts days inclusively and knows month lengths', () => {
    expect(daysInclusive('2026-09-01', '2026-09-30')).toBe(30);
    expect(daysInclusive('2026-09-10', '2026-09-10')).toBe(1);
    expect(daysInMonthOf('2026-02-10')).toBe(28);
    expect(daysInMonthOf('2028-02-10')).toBe(29);
  });

  it('pays a full month exactly the monthly rate', () => {
    const [line] = computePayroll('2026-09-01', '2026-09-30', 0, [
      {
        userId: 'a',
        payType: 'MONTHLY',
        rate: 30000,
        hoursWorked: 160,
        unpaidLeaveDays: 0,
      },
    ]);
    expect(line.basePay).toBe(30000);
    expect(line.netPay).toBe(30000);
  });

  it('pro-rates a partial month and deducts unpaid leave', () => {
    const [line] = computePayroll('2026-09-01', '2026-09-15', 0, [
      {
        userId: 'a',
        payType: 'MONTHLY',
        rate: 30000,
        hoursWorked: 80,
        unpaidLeaveDays: 2,
      },
    ]);
    expect(line.basePay).toBe(15000); // 15 / 30 of the month
    expect(line.unpaidLeaveDeduction).toBe(2000); // 2 days x 1000
    expect(line.netPay).toBe(13000);
  });

  it('pays hourly staff by clocked hours', () => {
    const [line] = computePayroll('2026-09-01', '2026-09-30', 0, [
      {
        userId: 'a',
        payType: 'HOURLY',
        rate: 150,
        hoursWorked: 40.5,
        unpaidLeaveDays: 3,
      },
    ]);
    expect(line.basePay).toBe(6075);
    expect(line.unpaidLeaveDeduction).toBe(0);
  });

  it('splits the tip pool by hours and always sums to the pool', () => {
    const lines = computePayroll('2026-09-01', '2026-09-30', 1000, [
      {
        userId: 'a',
        payType: 'HOURLY',
        rate: 0,
        hoursWorked: 10,
        unpaidLeaveDays: 0,
      },
      {
        userId: 'b',
        payType: 'HOURLY',
        rate: 0,
        hoursWorked: 10,
        unpaidLeaveDays: 0,
      },
      {
        userId: 'c',
        payType: 'HOURLY',
        rate: 0,
        hoursWorked: 10,
        unpaidLeaveDays: 0,
      },
      {
        userId: 'd',
        payType: 'HOURLY',
        rate: 0,
        hoursWorked: 0,
        unpaidLeaveDays: 0,
      },
    ]);
    const total = lines.reduce((s, l) => s + l.tipShare, 0);
    expect(Math.round(total * 100) / 100).toBe(1000);
    expect(lines[3].tipShare).toBe(0); // worked no hours, gets no tips
  });

  it('leaves the pool unallocated when nobody clocked in', () => {
    const lines = computePayroll('2026-09-01', '2026-09-30', 500, [
      {
        userId: 'a',
        payType: 'MONTHLY',
        rate: 100,
        hoursWorked: 0,
        unpaidLeaveDays: 0,
      },
    ]);
    expect(lines[0].tipShare).toBe(0);
  });
});

import { netWithAdjustments } from './payroll.calc';

describe('netWithAdjustments', () => {
  const base = { basePay: 30000, tipShare: 500, unpaidLeaveDeduction: 1000 };
  const none = {
    allowances: 0,
    bonus: 0,
    advanceRecovery: 0,
    otherDeductions: 0,
  };

  it('with no adjustments equals the calculated net', () => {
    expect(netWithAdjustments(base, none)).toBe(29500);
  });

  it('adds allowances and bonus, subtracts advance recovery and other deductions', () => {
    expect(
      netWithAdjustments(base, {
        allowances: 2000,
        bonus: 1500.5,
        advanceRecovery: 3000,
        otherDeductions: 250.25,
      }),
    ).toBe(29750.25);
  });

  it('stays exact on cent-level float traps', () => {
    expect(
      netWithAdjustments(
        { basePay: 0.1, tipShare: 0.2, unpaidLeaveDeduction: 0 },
        { ...none, bonus: 0.3 },
      ),
    ).toBe(0.6);
  });

  it('refuses a negative salary', () => {
    expect(() =>
      netWithAdjustments(base, { ...none, advanceRecovery: 40000 }),
    ).toThrow(/more than the pay/);
  });
});
