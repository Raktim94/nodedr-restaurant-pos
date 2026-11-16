// Updates made on a phone with no connection (a rider marking a delivery
// picked up or delivered, the kitchen moving a ticket) wait here and are sent,
// in order, when the server is reachable again. Money actions are never queued.
//
// Every queued update is a "set to this state" PATCH, so sending one twice is
// harmless; if another device already moved the record on, the server refuses
// it and the refusal is shown, never hidden.
import { ApiError, api } from "@/lib/api";
import { retryDelay, shouldRetry } from "@/lib/backoff";

export interface OutboxItem {
  key: string;
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  label: string;
  at: number;
  /** Who queued it. Another account signed in on this phone never sends it. */
  userId?: string;
  /** A newer item with the same group replaces an older waiting one (e.g. a priority star toggled twice). */
  group?: string;
  /** What the update means, so a screen can show it as already done while it waits. */
  meta?: { kind: "kot-status"; id: string; status: string } | { kind: "kot-priority"; id: string; isPriority: boolean };
}

const STORE = "orderrestro.outbox.v1";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

let currentUser: string | null = null;
/** Set by the signed-in shell; only this person's waiting updates are sent. */
export function setOutboxUser(id: string | null) {
  currentUser = id;
  notify();
}

function read(): OutboxItem[] {
  try {
    const items = JSON.parse(window.localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(items) ? (items as OutboxItem[]) : [];
  } catch {
    return []; // unreadable (corrupted) storage: nothing we can safely send
  }
}
function write(items: OutboxItem[]): boolean {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(items));
    return true;
  } catch {
    return false; // storage full or blocked
  } finally {
    notify();
  }
}

const mine = (x: OutboxItem) => !x.userId || !currentUser || x.userId === currentUser;

export const outbox = {
  all: read,
  /** Waiting updates that belong to the person signed in now. */
  count: () => read().filter(mine).length,
  /** Waiting updates from a different account that signed in on this phone earlier. */
  othersCount: () => read().filter((x) => !mine(x)).length,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  /** Returns false when the phone could not save it (storage full): the caller must tell the user. */
  add(item: Omit<OutboxItem, "key" | "at" | "userId">): boolean {
    const kept = item.group ? read().filter((x) => x.group !== item.group) : read();
    const ok = write([...kept, { ...item, userId: currentUser ?? undefined, key: crypto.randomUUID(), at: Date.now() }]);
    if (ok) scheduleRetry(0);
    return ok;
  },
  /** Updates the server turned down on the last send (e.g. the ticket moved on another screen). */
  refused: () => lastRefused,
  clearRefused() {
    lastRefused = [];
    notify();
  },
};

let lastRefused: string[] = [];

/** A fetch that never reached the server (no WiFi, server off, timed out), as opposed to the server saying no. */
export function isNetworkError(e: unknown) {
  return !(e instanceof ApiError);
}

function retryable(e: unknown) {
  return shouldRetry(isNetworkError(e) ? null : (e as ApiError).status);
}

const SEND_TIMEOUT_MS = 15_000;

let flushing = false;
/** Send what is waiting, oldest first. Stops at the first retryable failure; drops items the server refuses. */
export async function flushOutbox(): Promise<{ sent: number; refused: string[]; stalled: boolean }> {
  if (flushing) return { sent: 0, refused: [], stalled: false };
  flushing = true;
  let sent = 0;
  let stalled = false;
  let signedOut = false;
  const refused: string[] = [];
  try {
    for (const item of read().filter(mine)) {
      try {
        const init = { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) };
        if (item.method === "PATCH") await api.patch(item.path, item.body, init);
        else await api.post(item.path, item.body, init);
        sent++;
      } catch (e) {
        if (retryable(e)) {
          stalled = true;
          signedOut = e instanceof ApiError && e.status === 401;
          break; // keep it and everything after it, in order
        }
        refused.push(`${item.label}: ${e instanceof Error ? e.message : "refused"}`);
      }
      write(read().filter((x) => x.key !== item.key));
    }
  } finally {
    flushing = false;
  }
  if (refused.length > 0) {
    lastRefused = [...lastRefused, ...refused].slice(-10);
    notify();
  }
  // Signed out: no point retrying until someone signs in (the shell flushes again then).
  if (stalled && !signedOut) scheduleRetry();
  else attempt = 0;
  return { sent, refused, stalled };
}

// --- Retry with bounded exponential backoff and jitter -----------------------
// See lib/backoff.ts for the timing. Only runs while something is waiting,
// so an idle phone makes no requests at all.
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextAt = 0;

function scheduleRetry(delay?: number) {
  if (typeof window === "undefined" || outbox.count() === 0) return;
  if (timer) clearTimeout(timer);
  const ms = delay ?? retryDelay(attempt++);
  nextAt = Date.now() + ms;
  notify();
  timer = setTimeout(() => {
    timer = null;
    nextAt = 0;
    void flushOutbox();
  }, ms);
}

/** When the next automatic try happens (epoch ms), or 0 if none is planned. */
export const nextRetryAt = () => nextAt;

/** "Retry now": try immediately and restart the backoff. */
export function retryNow() {
  attempt = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  nextAt = 0;
  return flushOutbox();
}
