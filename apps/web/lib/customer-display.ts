// Mirrors the POS cart to the customer-facing screen.
//  * Same browser: BroadcastChannel, instant, needs no server (what the display always did).
//  * Another device (a tablet or second monitor on its own): the staff screen also reports the state to the
//    server for the screen chosen in Settings > Customer screen; that screen reads it with its own token.
// The server leg never blocks or fails the staff screen: if it cannot be reached the sale carries on and the
// customer screen simply keeps its last picture until the connection is back.
import { api } from "@/lib/api";
import type { DisplayStateDto } from "@nodedr-restaurant/types";

export interface DisplayLine {
  name: string;
  quantity: number;
  total: number;
}

export type DisplayState = DisplayStateDto;

const CHANNEL = "orderrestro-customer-display";
const KEY = "orderrestro.displayTerminal";

export function getDisplayTerminal(): { id: string; branchId: string; name?: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.id === "string" && typeof v.branchId === "string" ? v : null;
  } catch {
    return null;
  }
}

export function setDisplayTerminal(v: { id: string; branchId: string; name?: string } | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the same-browser mirror still works */
  }
}

let latest: DisplayState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastError: string | null = null;
export const displaySyncError = () => lastError;

function pushToServer(state: DisplayState) {
  const t = getDisplayTerminal();
  if (!t) return;
  latest = state;
  if (timer) return; // coalesce a burst of taps into one request
  timer = setTimeout(async () => {
    timer = null;
    const s = latest;
    if (!s) return;
    try {
      await api.put(`/display/terminals/${t.id}/state?branchId=${t.branchId}`, s);
      lastError = null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "offline";
    }
  }, 250);
}

export function publishDisplay(state: DisplayState) {
  if (typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(state);
    ch.close();
  }
  pushToServer(state);
}

export function subscribeDisplay(onState: (s: DisplayState) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<DisplayState>) => onState(e.data);
  return () => ch.close();
}
