"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";
import { formatPauseTime, menuPausesAt, type MenuPauseItem } from "@/lib/menu-pauses";

/** One timer for the nearest deadline, shared by the cards, picker and unsent cart. */
export function useMenuPauses(items: readonly MenuPauseItem[] | undefined): ReadonlyMap<string, string> {
  const [now, setNow] = useState(Date.now);
  const { paused, nextExpiry } = useMemo(() => menuPausesAt(items, now), [items, now]);
  useEffect(() => {
    if (nextExpiry === null) return;
    const refresh = () => setNow(Date.now());
    const timer = window.setTimeout(refresh, Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now())));
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [nextExpiry, now]);
  return paused;
}

export function useMenuPauseLabels(items: readonly MenuPauseItem[] | undefined, timezone?: string | null) {
  const paused = useMenuPauses(items);
  const { locale, t } = useI18n();
  return useMemo(() => {
    const labels = new Map<string, string>();
    for (const [id, until] of paused) {
      labels.set(id, t("menu.pausedUntil", { time: formatPauseTime(until, LOCALE_TAGS[locale], timezone) }));
    }
    return labels;
  }, [paused, locale, t, timezone]);
}
