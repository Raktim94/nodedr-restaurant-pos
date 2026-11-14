import { DEFAULT_MAX_AGE_DAYS, FUTURE_SKEW_MS, maxAgeDays, resolveSoldAt } from './sold-at';

const now = new Date('2026-11-14T10:00:00.000Z');
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe('resolveSoldAt', () => {
  it('keeps a normal past sale exactly', () => {
    const r = resolveSoldAt(iso(-3_600_000), now, 90);
    expect(r).toEqual({ ok: true, at: new Date(iso(-3_600_000)), clamped: false });
  });
  it('keeps a sale a few minutes ahead (clock drift)', () => {
    const r = resolveSoldAt(iso(FUTURE_SKEW_MS - 1000), now, 90);
    expect(r.ok && r.clamped).toBe(false);
  });
  it('books a sale from a clock running far ahead at the receive time, and says so', () => {
    const r = resolveSoldAt(iso(FUTURE_SKEW_MS + 1000), now, 90);
    expect(r).toEqual({ ok: true, at: now, clamped: true });
    const farFuture = resolveSoldAt('2099-01-01T00:00:00.000Z', now, 90);
    expect(farFuture).toEqual({ ok: true, at: now, clamped: true });
  });
  it('refuses a sale older than the window and keeps it recoverable', () => {
    const r = resolveSoldAt(iso(-91 * 86_400_000), now, 90);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/more than 90 days/);
  });
  it('accepts a sale just inside the window', () => {
    expect(resolveSoldAt(iso(-89 * 86_400_000), now, 90).ok).toBe(true);
  });
  it('refuses an unparseable time instead of crashing', () => {
    expect(resolveSoldAt('not a date', now, 90).ok).toBe(false);
  });
});

describe('maxAgeDays', () => {
  it('defaults and bounds the setting', () => {
    expect(maxAgeDays(undefined)).toBe(DEFAULT_MAX_AGE_DAYS);
    expect(maxAgeDays('30')).toBe(30);
    expect(maxAgeDays('0')).toBe(DEFAULT_MAX_AGE_DAYS);
    expect(maxAgeDays('abc')).toBe(DEFAULT_MAX_AGE_DAYS);
    expect(maxAgeDays('99999')).toBe(DEFAULT_MAX_AGE_DAYS);
  });
});
