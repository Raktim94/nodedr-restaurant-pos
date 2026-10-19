// Pure helpers for the payment step. The server prices the bill and validates
// every payment; these only decide what to show and what to send, so the
// screen and the printed bill never disagree about change or balance.
import { round2 } from "./pricing-preview.ts";

export type PayMethod = "CASH" | "CARD" | "UPI" | "OTHER" | string;

export interface PaymentPlan {
  /** False when there is nothing sensible to record (zero, negative, NaN). */
  valid: boolean;
  /** Amount applied to the bill. */
  applied: number;
  /** Cash handed over, only when it exceeds what is applied. */
  tendered?: number;
  /** Change to give back. */
  change: number;
  /** Balance left on the bill after this payment. */
  balanceAfter: number;
  /** This payment does not settle the bill. */
  partial: boolean;
  /** A non-cash amount above the balance was cut back to it. */
  clamped: boolean;
}

/**
 * What one payment entry means. `entered` is what the cashier typed (null =
 * they left it blank, meaning "the whole balance"). Cash may exceed the
 * balance - the rest is change. Any other method is capped at the balance,
 * because a card or UPI payment cannot be over-tendered.
 */
export function planPayment(input: {
  remaining: number;
  entered: number | null;
  method: PayMethod;
}): PaymentPlan {
  const remaining = round2(Math.max(input.remaining, 0));
  const amount = round2(input.entered ?? remaining);
  if (!Number.isFinite(amount) || (amount <= 0 && remaining > 0)) {
    return { valid: false, applied: 0, change: 0, balanceAfter: remaining, partial: false, clamped: false };
  }
  const applied = round2(Math.min(amount, remaining));
  const over = round2(amount - remaining);
  const isCash = input.method === "CASH";
  const change = isCash && over > 0 ? over : 0;
  const balanceAfter = round2(remaining - applied);
  return {
    valid: true,
    applied,
    tendered: change > 0 ? amount : undefined,
    change,
    balanceAfter,
    partial: balanceAfter > 0,
    clamped: !isCash && over > 0,
  };
}

/** "10% (₹20.00)" - the discount as both percentage and amount. */
export function discountSummary(
  discountPercent: number,
  discountAmount: number,
  format: (n: number) => string,
): string {
  const pct = Number.isInteger(discountPercent) ? String(discountPercent) : discountPercent.toFixed(2);
  return `${pct}% (${format(discountAmount)})`;
}

/** Parse a money input; blank means "not entered" (null), junk is NaN. */
export function parseMoney(value: string): number | null {
  const t = value.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? round2(n) : Number.NaN;
}
