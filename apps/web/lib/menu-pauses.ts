export interface MenuPauseItem {
  id: string;
  pausedUntil?: string | null;
}

export interface ReportedPause {
  id: string;
  pausedUntil: string;
}

/** A rejected order can report a newer pause than the last successful menu fetch. */
export function withReportedPauses<T extends MenuPauseItem>(items: T[], reported: ReportedPause[]): T[] {
  const byId = new Map(reported.map((item) => [item.id, item.pausedUntil]));
  return items.map((item) => {
    const until = byId.get(item.id);
    return until ? { ...item, pausedUntil: until } : item;
  });
}

export function withReportedMenuPauses<T extends { categories: { items: MenuPauseItem[] }[] }>(
  menu: T | undefined, reported: ReportedPause[],
): T | undefined {
  if (!menu || !reported.length) return menu;
  return { ...menu, categories: menu.categories.map((category) => ({
    ...category, items: withReportedPauses(category.items, reported),
  })) };
}

export function menuPausesAt(items: readonly MenuPauseItem[] | undefined, now: number) {
  const paused = new Map<string, string>();
  let nextExpiry: number | null = null;
  for (const item of items ?? []) {
    if (!item.pausedUntil) continue;
    const end = Date.parse(item.pausedUntil);
    if (end > now) {
      paused.set(item.id, item.pausedUntil);
      if (nextExpiry === null || end < nextExpiry) nextExpiry = end;
    }
  }
  return { paused, nextExpiry };
}

/** Include the date for pauses crossing midnight in the restaurant's timezone. */
export function formatPauseTime(until: string, locale: string, timezone?: string | null): string {
  const date = new Date(until);
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  if (timezone) {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }).format(date);
    } catch {
      // Older restaurant settings allowed arbitrary text for the timezone.
    }
  }
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC", timeZoneName: "short" }).format(date);
}
