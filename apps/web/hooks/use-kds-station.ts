"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { readStation, writeStation } from "@/lib/kds-station";

// Same-tab notifications (the `storage` event only fires in OTHER tabs).
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * The station this device is pinned to for `branchId`. The saved value is read
 * synchronously for the CURRENT branch on every render, so switching branches
 * can never apply the previous branch's selection, and `saved` is null until
 * the client has read storage (server render / hydration), which callers treat
 * as "not ready, don't fetch yet".
 */
export function useKdsStationPreference(branchId: string | null) {
  const saved = useSyncExternalStore(
    subscribe,
    () => (branchId ? readStation(storage(), branchId).value : ""),
    () => null,
  );
  const [saveFailed, setSaveFailed] = useState(false);
  // Choices made while storage is blocked still apply until reload.
  const [session, setSession] = useState<{ branchId: string | null; id: string } | null>(null);

  const choose = useCallback(
    (id: string) => {
      if (!branchId) return;
      const ok = writeStation(storage(), branchId, id);
      setSaveFailed(!ok);
      setSession(ok ? null : { branchId, id });
      notify();
    },
    [branchId],
  );

  const fallback = session && session.branchId === branchId ? session.id : null;
  return {
    ready: saved !== null && !!branchId,
    saved: fallback ?? saved ?? "",
    saveFailed,
    choose,
  };
}
