// Mirrors the POS cart to a second screen (a customer-facing display) open in
// another window of the same browser. BroadcastChannel never leaves the
// machine, so no server, account or network is involved.

export interface DisplayLine {
  name: string;
  quantity: number;
  total: number;
}

export type DisplayState =
  | { kind: "idle" }
  | { kind: "cart"; lines: DisplayLine[]; subtotal: number }
  | { kind: "paid"; total: number };

const CHANNEL = "orderrestro-customer-display";

export function publishDisplay(state: DisplayState) {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.postMessage(state);
  ch.close();
}

export function subscribeDisplay(onState: (s: DisplayState) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e: MessageEvent<DisplayState>) => onState(e.data);
  return () => ch.close();
}
