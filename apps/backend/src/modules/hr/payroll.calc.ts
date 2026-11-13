// Pure payroll maths, kept separate from the database code so it can be
// unit-tested. All money is in major units (e.g. rupees), rounded to 2 dp.

export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

export interface PayInput {
  userId: string;
  payType: 'MONTHLY' | 'HOURLY';
  rate: number;
  hoursWorked: number;
  /** Approved UNPAID leave days that fall inside the period. */
  unpaidLeaveDays: number;
  /**
   * The same leave days split by calendar month ("2026-02": 2). When given, each day is priced at
   * rate / days-in-THAT-month, so a leave day in February costs more than one in March.
   */
  unpaidLeaveByMonth?: Record<string, number>;
}

/** Calendar months touched by a period, with how many of the period's days fall in each. */
export function monthSlices(start: string, end: string) {
  const out: { key: string; days: number; monthDays: number }[] = [];
  let cursor = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  while (cursor <= last) {
    const d = new Date(cursor);
    const key = d.toISOString().slice(0, 7);
    const monthDays = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const lastOfMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), monthDays);
    const stop = Math.min(last, lastOfMonth);
    out.push({ key, days: Math.round((stop - cursor) / 86_400_000) + 1, monthDays });
    cursor = stop + 86_400_000;
  }
  return out;
}

export interface Interval {
  start: number;
  end: number;
}

/**
 * Hours worked inside [from, to): attendance rows are clipped to the window, overlapping or duplicate
 * rows are merged so the same minute is never paid twice, and rows still open (no clock-out) are not
 * counted. Returns the hours and how many rows overlapped another.
 */
export function workedHours(rows: Interval[], from: number, to: number) {
  const clipped = rows
    .map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  let ms = 0;
  let overlaps = 0;
  let cur: Interval | null = null;
  for (const r of clipped) {
    if (cur && r.start < cur.end) {
      overlaps++;
      cur.end = Math.max(cur.end, r.end);
    } else {
      if (cur) ms += cur.end - cur.start;
      cur = { ...r };
    }
  }
  if (cur) ms += cur.end - cur.start;
  return { hours: ms / 3_600_000, overlaps };
}

export interface PayLineResult {
  userId: string;
  hoursWorked: number;
  basePay: number;
  tipShare: number;
  unpaidLeaveDeduction: number;
  netPay: number;
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysInclusive(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export function daysInMonthOf(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * MONTHLY staff earn rate x (period days / days in the period's first
 * month), so a full calendar month pays exactly the rate. UNPAID leave
 * deducts a day's pay (rate / days in month) per day. HOURLY staff earn
 * rate x clocked hours and have no leave deduction (unpaid by nature).
 *
 * The tip pool is split in proportion to hours worked; the last recipient
 * absorbs rounding so the shares always add up to the pool exactly.
 */
export function computePayroll(
  periodStart: string,
  periodEnd: string,
  tipPool: number,
  staff: PayInput[],
): PayLineResult[] {
  const slices = monthSlices(periodStart, periodEnd);
  const totalHours = staff.reduce((s, p) => s + p.hoursWorked, 0);

  const tipRecipients = staff.filter((p) => p.hoursWorked > 0);
  const tips = new Map<string, number>();
  if (tipPool > 0 && totalHours > 0) {
    let allocated = 0;
    tipRecipients.forEach((p, i) => {
      const share =
        i === tipRecipients.length - 1
          ? round2(tipPool - allocated)
          : round2((tipPool * p.hoursWorked) / totalHours);
      allocated = round2(allocated + share);
      tips.set(p.userId, share);
    });
  }

  return staff.map((p) => {
    const hours = round2(p.hoursWorked);
    let basePay: number;
    let deduction = 0;
    if (p.payType === 'HOURLY') {
      basePay = round2(p.rate * p.hoursWorked);
    } else {
      // Each calendar month is pro-rated by its own length, so a whole month is exactly the rate
      // whatever the month, and a period that straddles two months is not priced by the first one.
      basePay = round2(
        slices.reduce((sum, m) => sum + (p.rate * m.days) / m.monthDays, 0),
      );
      const byMonth =
        p.unpaidLeaveByMonth ?? { [slices[0].key]: p.unpaidLeaveDays };
      deduction = round2(
        Object.entries(byMonth).reduce((sum, [key, days]) => {
          const [y, m] = key.split('-').map(Number);
          const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return sum + (p.rate / len) * days;
        }, 0),
      );
    }
    const tipShare = tips.get(p.userId) ?? 0;
    return {
      userId: p.userId,
      hoursWorked: hours,
      basePay,
      tipShare,
      unpaidLeaveDeduction: deduction,
      netPay: round2(basePay - deduction + tipShare),
    };
  });
}

export interface LineAdjustments {
  allowances: number;
  bonus: number;
  advanceRecovery: number;
  otherDeductions: number;
}

/**
 * Net pay once manual adjustments are applied on top of the calculated pay.
 * Everything is added or subtracted in 2-dp steps so the stored net always
 * equals the printed lines; a draft whose deductions exceed its pay is
 * refused rather than saved as a negative salary.
 */
export function netWithAdjustments(
  line: { basePay: number; tipShare: number; unpaidLeaveDeduction: number },
  adj: LineAdjustments,
): number {
  const earned = round2(
    line.basePay + line.tipShare + adj.allowances + adj.bonus,
  );
  const deducted = round2(
    line.unpaidLeaveDeduction + adj.advanceRecovery + adj.otherDeductions,
  );
  const net = round2(earned - deducted);
  if (net < 0) {
    throw new RangeError(
      `Deductions (${deducted}) are more than the pay (${earned})`,
    );
  }
  return net;
}
