import { round2 } from './payroll.calc';
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

import { monthSlices, workedHours } from './payroll.calc';

describe('payroll boundaries', () => {
  const H = 3_600_000;
  const t = (iso: string) => Date.parse(iso);

  it('prices each calendar month by its own length', () => {
    // 15 Jan to 13 Feb: 17/31 + 13/28 of a month, not 30/31
    const [line] = computePayroll('2026-01-15', '2026-02-13', 0, [
      { userId: 'a', payType: 'MONTHLY', rate: 31000, hoursWorked: 0, unpaidLeaveDays: 0 },
    ]);
    expect(line.basePay).toBe(round2((31000 * 17) / 31 + (31000 * 13) / 28));
    expect(monthSlices('2026-01-15', '2026-02-13')).toEqual([
      { key: '2026-01', days: 17, monthDays: 31 },
      { key: '2026-02', days: 13, monthDays: 28 },
    ]);
  });

  it('a whole calendar month is exactly the rate in every month, leap year included', () => {
    for (const [a, b] of [['2026-02-01', '2026-02-28'], ['2028-02-01', '2028-02-29'], ['2026-04-01', '2026-04-30'], ['2026-12-01', '2026-12-31']]) {
      const [l] = computePayroll(a, b, 0, [{ userId: 'a', payType: 'MONTHLY', rate: 30000, hoursWorked: 0, unpaidLeaveDays: 0 }]);
      expect(l.basePay).toBe(30000);
    }
  });

  it('prices unpaid leave by the month the leave day is in', () => {
    const [l] = computePayroll('2026-02-01', '2026-03-31', 0, [
      { userId: 'a', payType: 'MONTHLY', rate: 28000, hoursWorked: 0, unpaidLeaveDays: 2, unpaidLeaveByMonth: { '2026-02': 1, '2026-03': 1 } },
    ]);
    expect(l.unpaidLeaveDeduction).toBe(round2(28000 / 28 + 28000 / 31));
  });

  it('merges duplicate and overlapping attendance so a minute is paid once', () => {
    const rows = [
      { start: t('2026-03-02T09:00:00Z'), end: t('2026-03-02T17:00:00Z') },
      { start: t('2026-03-02T09:00:00Z'), end: t('2026-03-02T17:00:00Z') }, // same row twice
      { start: t('2026-03-02T16:00:00Z'), end: t('2026-03-02T18:00:00Z') }, // overlaps the end
    ];
    const w = workedHours(rows, t('2026-03-02T00:00:00Z'), t('2026-03-03T00:00:00Z'));
    expect(w.hours).toBe(9);
    expect(w.overlaps).toBe(2);
  });

  it('clips a night shift to the period and drops rows that are outside it', () => {
    const from = t('2026-03-01T00:00:00Z');
    const to = t('2026-03-02T00:00:00Z');
    const w = workedHours(
      [
        { start: t('2026-02-28T22:00:00Z'), end: t('2026-03-01T06:00:00Z') }, // 6 h inside
        { start: t('2026-03-02T01:00:00Z'), end: t('2026-03-02T05:00:00Z') }, // outside
      ],
      from,
      to,
    );
    expect(w.hours).toBe(6);
  });

  it('missing attendance means zero hours, not scheduled hours', () => {
    const [l] = computePayroll('2026-03-01', '2026-03-31', 0, [
      { userId: 'a', payType: 'HOURLY', rate: 200, hoursWorked: workedHours([], 0, 9e15).hours, unpaidLeaveDays: 0 },
    ]);
    expect(l.basePay).toBe(0);
    expect(l.netPay).toBe(0);
  });

  it('rounds half-up to 2 dp and the tip pool still sums exactly', () => {
    const out = computePayroll('2026-03-01', '2026-03-31', 100, [
      { userId: 'a', payType: 'HOURLY', rate: 100.005, hoursWorked: 1, unpaidLeaveDays: 0 },
      { userId: 'b', payType: 'HOURLY', rate: 10, hoursWorked: 1, unpaidLeaveDays: 0 },
      { userId: 'c', payType: 'HOURLY', rate: 10, hoursWorked: 1, unpaidLeaveDays: 0 },
    ]);
    expect(out.reduce((s, l) => s + l.tipShare, 0)).toBeCloseTo(100, 10);
    expect(out[0].basePay).toBe(100.01);
  });

  it('zero rate and zero hours give zero, never negative', () => {
    const [l] = computePayroll('2026-03-01', '2026-03-31', 0, [
      { userId: 'a', payType: 'MONTHLY', rate: 0, hoursWorked: 0, unpaidLeaveDays: 3 },
    ]);
    expect(l.netPay).toBe(0);
    expect(H).toBe(3_600_000);
  });
});

import { workedByDay } from './payroll.calc';

describe('breaks and overtime', () => {
  const t = (iso: string) => Date.parse(iso);
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const day = (a: string, b: string, breakMinutes = 0) => ({ start: t(a), end: t(b), breakMinutes });

  it('takes the unpaid break off the paid hours', () => {
    const w = workedByDay([day('2026-03-02T04:00:00Z', '2026-03-02T13:00:00Z', 60)], 0, 9e15, date);
    expect(w.hours).toBe(8);
  });

  it('counts a duplicated shift and its break once', () => {
    const r = day('2026-03-02T04:00:00Z', '2026-03-02T13:00:00Z', 30);
    expect(workedByDay([r, r], 0, 9e15, date).hours).toBe(8.5);
  });

  it('pays overtime per day above the threshold at the multiplier', () => {
    const [l] = computePayroll('2026-03-01', '2026-03-31', 0, [
      { userId: 'a', payType: 'HOURLY', rate: 100, hoursWorked: 19, dailyHours: [10, 9], overtimeAfterHours: 8, overtimeMultiplier: 1.5, unpaidLeaveDays: 0 },
    ]);
    expect(l.overtimeHours).toBe(3); // 2 + 1
    expect(l.overtimePay).toBe(450);
    expect(l.basePay).toBe(1600 + 450);
    expect(l.formula).toHaveLength(2);
  });

  it('exactly at the threshold is not overtime; no rule means no overtime', () => {
    const base = { userId: 'a', payType: 'HOURLY' as const, rate: 100, hoursWorked: 16, dailyHours: [8, 8], unpaidLeaveDays: 0 };
    expect(computePayroll('2026-03-01', '2026-03-31', 0, [{ ...base, overtimeAfterHours: 8 }])[0].overtimeHours).toBe(0);
    const none = computePayroll('2026-03-01', '2026-03-31', 0, [{ ...base, dailyHours: [12, 4] }])[0];
    expect(none.overtimeHours).toBe(0);
    expect(none.basePay).toBe(1600);
  });

  it('a midnight-crossing shift belongs to the day it started', () => {
    const w = workedByDay([day('2026-03-02T20:00:00Z', '2026-03-03T04:00:00Z')], 0, 9e15, date);
    expect([...w.byDay.keys()]).toEqual(['2026-03-02']);
    expect(w.hours).toBe(8);
  });

  it('shows how monthly pay was reached', () => {
    const [l] = computePayroll('2026-02-01', '2026-02-28', 0, [{ userId: 'a', payType: 'MONTHLY', rate: 28000, hoursWorked: 0, unpaidLeaveDays: 0 }]);
    expect(l.formula[0]).toBe('2026-02: 28000 x 28/28 days = 28000');
  });
});
