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
  /** HOURLY: hours worked on each local day (already net of unpaid breaks). Enables the overtime rule. */
  dailyHours?: number[];
  overtimeAfterHours?: number | null;
  overtimeMultiplier?: number;
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

export interface Shift {
  start: number;
  end: number;
  breakMinutes?: number;
}

/**
 * Paid hours per local day. Shifts are clipped to [from, to), duplicates and overlaps are merged (the
 * longest unpaid break in a merged group is taken off once), and each merged block belongs to the local
 * date it starts on. Scheduled time is never used: only clocked time.
 */
export function workedByDay(
  rows: Shift[],
  from: number,
  to: number,
  dateOf: (ms: number) => string,
) {
  const clipped = rows
    .map((r) => ({ start: Math.max(r.start, from), end: Math.min(r.end, to), br: r.breakMinutes ?? 0 }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const groups: { start: number; end: number; br: number }[] = [];
  let overlaps = 0;
  for (const r of clipped) {
    const g = groups[groups.length - 1];
    if (g && r.start < g.end) {
      overlaps++;
      g.end = Math.max(g.end, r.end);
      g.br = Math.max(g.br, r.br);
    } else groups.push({ ...r });
  }
  const byDay = new Map<string, number>();
  for (const g of groups) {
    const hours = Math.max(0, (g.end - g.start) / 3_600_000 - g.br / 60);
    const day = dateOf(g.start);
    byDay.set(day, (byDay.get(day) ?? 0) + hours);
  }
  const days = [...byDay.values()];
  return { byDay, days, hours: days.reduce((a, b) => a + b, 0), overlaps };
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
  overtimeHours: number;
  overtimePay: number;
  /** Plain-language lines showing exactly how the base pay was reached. */
  formula: string[];
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
    let overtimeHours = 0;
    let overtimePay = 0;
    const formula: string[] = [];
    if (p.payType === 'HOURLY') {
      const limit = p.overtimeAfterHours ?? null;
      if (limit != null && p.dailyHours) {
        overtimeHours = round2(
          p.dailyHours.reduce((s, h) => s + Math.max(0, h - limit), 0),
        );
        const regular = round2(p.hoursWorked - overtimeHours);
        const mult = p.overtimeMultiplier ?? 1.5;
        overtimePay = round2(overtimeHours * p.rate * mult);
        basePay = round2(regular * p.rate + overtimePay);
        formula.push(
          `${regular} h regular x ${p.rate} = ${round2(regular * p.rate)}`,
          `${overtimeHours} h over ${limit} h a day x ${p.rate} x ${mult} = ${overtimePay}`,
        );
      } else {
        basePay = round2(p.rate * p.hoursWorked);
        formula.push(`${hours} h x ${p.rate} = ${basePay}`);
      }
    } else {
      // Each calendar month is pro-rated by its own length, so a whole month is exactly the rate
      // whatever the month, and a period that straddles two months is not priced by the first one.
      basePay = round2(
        slices.reduce((sum, m) => sum + (p.rate * m.days) / m.monthDays, 0),
      );
      const byMonth =
        p.unpaidLeaveByMonth ?? { [slices[0].key]: p.unpaidLeaveDays };
      formula.push(
        ...slices.map(
          (m) => `${m.key}: ${p.rate} x ${m.days}/${m.monthDays} days = ${round2((p.rate * m.days) / m.monthDays)}`,
        ),
      );
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
      overtimeHours,
      overtimePay,
      formula,
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
