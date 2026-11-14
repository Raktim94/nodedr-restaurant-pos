import {
  playableAds,
  screenFor,
  type DisplayStateDto,
} from '@nodedr-restaurant/types';

const cfg = { idleSeconds: 45, thankYouSeconds: 8 };
const cart = (n = 1): DisplayStateDto => ({
  kind: 'cart',
  lines: Array.from({ length: n }, (_, i) => ({
    name: `Item ${i}`,
    quantity: 1,
    total: 10,
  })),
  subtotal: 10 * n,
});
const at = 1_000_000;

describe('which screen the customer sees', () => {
  it('shows adverts when nothing is known, idle, or the state is unreadable', () => {
    expect(screenFor(null, null, at, cfg)).toBe('ads');
    expect(screenFor({ kind: 'idle' }, at, at, cfg)).toBe('ads');
    expect(screenFor(cart(), NaN, at, cfg)).toBe('ads');
  });

  it('an order in progress shows the very moment it exists: no delay, whatever the adverts are doing', () => {
    expect(screenFor(cart(), at, at, cfg)).toBe('order');
    expect(screenFor(cart(), at, at + 1, cfg)).toBe('order');
  });

  it('an emptied basket goes back to adverts', () => {
    expect(screenFor(cart(0), at, at, cfg)).toBe('ads');
  });

  it('an order left alone returns to adverts after the idle time, and updates keep it on screen', () => {
    expect(screenFor(cart(), at, at + 45_000, cfg)).toBe('order');
    expect(screenFor(cart(), at, at + 45_001, cfg)).toBe('ads');
    expect(screenFor(cart(2), at + 40_000, at + 80_000, cfg)).toBe('order'); // staff added an item 40 s in
  });

  it('a payment QR stays up for at least three minutes, then gives way', () => {
    const upi: DisplayStateDto = {
      kind: 'upi',
      total: 100,
      uri: 'upi://pay',
      payee: 'Shop',
    };
    expect(screenFor(upi, at, at + 170_000, cfg)).toBe('pay');
    expect(screenFor(upi, at, at + 181_000, cfg)).toBe('ads');
  });

  it('"thank you" lasts its few seconds, then adverts', () => {
    const paid: DisplayStateDto = { kind: 'paid', total: 100 };
    expect(screenFor(paid, at, at + 7_000, cfg)).toBe('thanks');
    expect(screenFor(paid, at, at + 9_000, cfg)).toBe('ads');
  });

  it('a clock that is a little behind never makes a fresh order look old or "from the future"', () => {
    expect(screenFor(cart(), at + 5_000, at, cfg)).toBe('order');
  });
});

describe('which adverts play', () => {
  const ad = (id: string, over: object = {}) => ({
    id,
    kind: 'IMAGE' as const,
    url: `/api/uploads/${id}.png`,
    isActive: true,
    sortOrder: 0,
    ...over,
  });
  const now = new Date('2026-11-14T12:00:00Z');
  it('respects switched-off, schedule, per-screen targeting and order', () => {
    const list = [
      ad('c', { sortOrder: 3 }),
      ad('a', { sortOrder: 1, terminalId: 't1' }),
      ad('off', { isActive: false }),
      ad('later', { startsOn: '2026-12-01T00:00:00Z' }),
      ad('ended', { endsOn: '2026-11-01T00:00:00Z' }),
      ad('other', { terminalId: 't2' }),
      ad('b', { sortOrder: 2, endsOn: '2026-11-30T00:00:00Z' }),
    ];
    expect(playableAds(list, 't1', now).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(playableAds(list, 't2', now).map((x) => x.id)).toEqual(
      ['b', 'c', 'other'].sort(
        (x, y) =>
          list.find((l) => l.id === x)!.sortOrder -
          list.find((l) => l.id === y)!.sortOrder,
      ),
    );
  });
});
