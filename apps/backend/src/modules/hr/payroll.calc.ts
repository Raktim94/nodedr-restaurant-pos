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
  const periodDays = daysInclusive(periodStart, periodEnd);
  const monthDays = daysInMonthOf(periodStart);
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
      basePay = round2((p.rate * periodDays) / monthDays);
      deduction = round2((p.rate / monthDays) * p.unpaidLeaveDays);
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
