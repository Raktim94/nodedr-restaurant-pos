/**
 * The time an offline sale is booked at. It comes from the phone's clock, which is often wrong,
 * so it is never trusted blindly:
 *  - a little ahead of the server is normal clock drift and is kept;
 *  - further ahead is a wrong clock: the sale is real money, so it is kept but booked at the time
 *    the server received it, and flagged so the owner can see why;
 *  - older than the window is refused with a clear reason (it would land inside a closed day,
 *    tax period or payroll run), and stays on the phone for the owner to deal with.
 */
export const FUTURE_SKEW_MS = 10 * 60_000;
export const DEFAULT_MAX_AGE_DAYS = 90;

export type SoldAtResolution =
  { ok: true; at: Date; clamped: boolean } | { ok: false; reason: string };

export function maxAgeDays(
  env: string | undefined = process.env.OFFLINE_SALE_MAX_AGE_DAYS,
): number {
  const n = Number(env);
  return Number.isFinite(n) && n >= 1 && n <= 3650
    ? Math.floor(n)
    : DEFAULT_MAX_AGE_DAYS;
}

export function resolveSoldAt(
  soldAt: string,
  now: Date = new Date(),
  maxDays: number = maxAgeDays(),
): SoldAtResolution {
  const t = new Date(soldAt);
  if (Number.isNaN(t.getTime()))
    return { ok: false, reason: 'The sale has no valid time.' };
  if (t.getTime() > now.getTime() + FUTURE_SKEW_MS)
    return { ok: true, at: now, clamped: true };
  if (t.getTime() < now.getTime() - maxDays * 86_400_000) {
    return {
      ok: false,
      reason: `This sale is more than ${maxDays} days old, so it cannot be added to the books automatically. Check the phone's date, then ask the owner to enter it by hand.`,
    };
  }
  return { ok: true, at: t, clamped: false };
}
