import { DEFAULT_PREFS, sanitizePrefs } from './dashboard-prefs';

describe('sanitizePrefs', () => {
  it('returns the defaults for nothing or garbage', () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs('x')).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(42)).toEqual(DEFAULT_PREFS);
  });

  it('keeps a valid custom order and appends widgets it forgot', () => {
    const p = sanitizePrefs({
      topOrder: ['charts', 'kpis'],
      cardOrder: ['recent'],
    });
    expect(p.topOrder).toEqual(['charts', 'kpis', 'attention']);
    expect(p.cardOrder).toEqual(['recent', 'tables', 'kitchen', 'channels']);
  });

  it('drops unknown ids, duplicates and non-strings', () => {
    const p = sanitizePrefs({
      topOrder: ['kpis', 'kpis', '<script>', 7, 'charts'],
      hidden: ['tables', 'tables', 'nope', 3, '__proto__'],
    });
    expect(p.topOrder).toEqual(['kpis', 'charts', 'attention']);
    expect(p.hidden).toEqual(['tables']);
  });

  it('only allows the supported reporting windows', () => {
    expect(sanitizePrefs({ trendDays: 30 }).trendDays).toBe(30);
    expect(sanitizePrefs({ trendDays: '7' }).trendDays).toBe(7);
    expect(sanitizePrefs({ trendDays: 365 }).trendDays).toBe(14);
    expect(sanitizePrefs({ trendDays: -1 }).trendDays).toBe(14);
    expect(sanitizePrefs({ trendDays: 'abc' }).trendDays).toBe(14);
  });

  it('never mutates the shared defaults', () => {
    const p = sanitizePrefs({});
    p.hidden.push('kpis');
    p.topOrder.reverse();
    expect(sanitizePrefs({})).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.hidden).toEqual([]);
  });
});
