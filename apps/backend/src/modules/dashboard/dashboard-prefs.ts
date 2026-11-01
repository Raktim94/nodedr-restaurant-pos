// Per-user dashboard layout. Pure, so the whitelist and the clamping are
// unit-tested; the API never stores what this does not return.

export const TOP_WIDGETS = ['kpis', 'attention', 'charts'] as const;
export const CARD_WIDGETS = [
  'tables',
  'kitchen',
  'recent',
  'channels',
] as const;
export const TREND_DAYS = [7, 14, 30, 90] as const;

export interface DashboardPrefs {
  /** Left-to-right/top-to-bottom order of the large blocks. */
  topOrder: string[];
  /** Order of the small cards in the grid underneath. */
  cardOrder: string[];
  hidden: string[];
  /** Reporting window for the revenue and waste charts. */
  trendDays: number;
}

export const DEFAULT_PREFS: DashboardPrefs = {
  topOrder: [...TOP_WIDGETS],
  cardOrder: [...CARD_WIDGETS],
  hidden: [],
  trendDays: 14,
};

/** Keeps known ids once each, in the given order, then appends any that are missing. */
function ordered(input: unknown, allowed: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (Array.isArray(input)) {
    for (const v of input) {
      if (typeof v === 'string' && allowed.includes(v) && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  for (const a of allowed) if (!seen.has(a)) out.push(a);
  return out;
}

export function sanitizePrefs(raw: unknown): DashboardPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const all = [...TOP_WIDGETS, ...CARD_WIDGETS] as string[];
  const hidden = Array.isArray(r.hidden)
    ? [
        ...new Set(
          r.hidden.filter(
            (v): v is string => typeof v === 'string' && all.includes(v),
          ),
        ),
      ]
    : [];
  const days = Number(r.trendDays);
  return {
    topOrder: ordered(r.topOrder, TOP_WIDGETS),
    cardOrder: ordered(r.cardOrder, CARD_WIDGETS),
    hidden,
    trendDays: (TREND_DAYS as readonly number[]).includes(days)
      ? days
      : DEFAULT_PREFS.trendDays,
  };
}
