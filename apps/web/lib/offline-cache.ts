// Keeps the data the screens last showed (menu, tables, open bills, dashboard)
// on this device, so when the connection to the restaurant server drops the
// POS, tables and menu still show what they showed a moment ago instead of
// going blank. Only data that was fetched successfully is kept. It is cleared
// on sign out.
import type { QueryClient } from "@tanstack/react-query";

const KEY = "orderrestro.cache.v1";
const MAX_BYTES = 2_500_000; // stay well inside the ~5 MB storage limit
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

interface Entry {
  k: unknown[];
  d: unknown;
  t: number;
}

// Not kept: anything that is a live feed or one-off, and the very large lists.
// "auth" is never kept: a saved copy must not make a signed-out phone look signed in.
const SKIP = new Set(["auth", "kds", "realtime", "reports", "print", "audit"]);
// The kitchen board is the exception: tickets and stations are kept so the
// kitchen can still read what is cooking when the connection drops.
const KDS_KEEP = new Set(["tickets", "stations"]);

function skipped(key: readonly unknown[]) {
  const head = String(key[0]);
  if (head === "kds") return !KDS_KEEP.has(String(key[1]));
  return SKIP.has(head);
}

export function clearOfflineCache() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing was kept
  }
}

export function restoreOfflineCache(qc: QueryClient) {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Entry[];
    const now = Date.now();
    for (const e of entries) {
      if (now - e.t > MAX_AGE_MS) continue;
      // Never overwrite something already fetched this session.
      if (qc.getQueryData(e.k) === undefined) qc.setQueryData(e.k, e.d, { updatedAt: e.t });
    }
  } catch {
    clearOfflineCache();
  }
}

/** Save successful query results (debounced). Returns the unsubscribe function. */
export function persistOfflineCache(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    try {
      const entries: Entry[] = [];
      let size = 0;
      for (const q of qc.getQueryCache().getAll()) {
        if (q.state.status !== "success" || q.state.data === undefined) continue;
        if (skipped(q.queryKey)) continue;
        const e: Entry = { k: q.queryKey as unknown[], d: q.state.data, t: q.state.dataUpdatedAt };
        const s = JSON.stringify(e).length;
        if (s > 400_000 || size + s > MAX_BYTES) continue;
        size += s;
        entries.push(e);
      }
      window.localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      // storage full or blocked: the live data still works, it just is not kept
    }
  };
  const unsubscribe = qc.getQueryCache().subscribe((ev) => {
    if (ev.type === "updated" && ev.action.type === "success") {
      clearTimeout(timer);
      timer = setTimeout(save, 2000);
    }
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
