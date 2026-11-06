// Updates made on a phone with no connection (a rider marking a delivery
// picked up or delivered) wait here and are sent, in order, when the server is
// reachable again. Money actions are never queued.
import { ApiError, api } from "@/lib/api";

export interface OutboxItem {
  key: string;
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  label: string;
  at: number;
  /** A newer item with the same group replaces an older waiting one (e.g. a priority star toggled twice). */
  group?: string;
  /** What the update means, so a screen can show it as already done while it waits. */
  meta?: { kind: "kot-status"; id: string; status: string } | { kind: "kot-priority"; id: string; isPriority: boolean };
}

const STORE = "orderrestro.outbox.v1";
const listeners = new Set<() => void>();

function read(): OutboxItem[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) ?? "[]") as OutboxItem[];
  } catch {
    return [];
  }
}
function write(items: OutboxItem[]) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(items));
  } catch {
    // storage full or blocked: the update is lost, which only happens offline anyway
  }
  listeners.forEach((l) => l());
}

export const outbox = {
  all: read,
  count: () => read().length,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  add(item: Omit<OutboxItem, "key" | "at">) {
    const kept = item.group ? read().filter((x) => x.group !== item.group) : read();
    write([...kept, { ...item, key: crypto.randomUUID(), at: Date.now() }]);
  },
  /** Updates the server turned down on the last send (e.g. the ticket moved on another screen). */
  refused: () => lastRefused,
  clearRefused() {
    lastRefused = [];
    listeners.forEach((l) => l());
  },
};

let lastRefused: string[] = [];

/** A fetch that never reached the server (no WiFi, server off), as opposed to the server saying no. */
export function isNetworkError(e: unknown) {
  return !(e instanceof ApiError);
}

let flushing = false;
/** Send what is waiting. Stops at the first network failure; drops items the server refuses. */
export async function flushOutbox(): Promise<{ sent: number; refused: string[] }> {
  if (flushing) return { sent: 0, refused: [] };
  flushing = true;
  let sent = 0;
  const refused: string[] = [];
  try {
    for (const item of read()) {
      try {
        if (item.method === "PATCH") await api.patch(item.path, item.body);
        else await api.post(item.path, item.body);
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        // 401: signed out, keep it for after sign-in. Any other refusal is final.
        if (e instanceof ApiError && e.status === 401) break;
        refused.push(`${item.label}: ${e instanceof Error ? e.message : "refused"}`);
      }
      write(read().filter((x) => x.key !== item.key));
    }
  } finally {
    flushing = false;
  }
  if (refused.length > 0) {
    lastRefused = [...lastRefused, ...refused].slice(-10);
    listeners.forEach((l) => l());
  }
  return { sent, refused };
}
