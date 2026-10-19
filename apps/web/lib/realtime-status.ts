// Whether the live-update socket is connected, shared by every screen that
// wants to say so. Updated by useRealtime; read with useSyncExternalStore.
import { useSyncExternalStore } from "react";

export type RealtimeState = "connecting" | "live" | "offline";

let state: RealtimeState = "connecting";
const listeners = new Set<() => void>();

export function setRealtimeState(next: RealtimeState) {
  if (state === next) return;
  state = next;
  listeners.forEach((l) => l());
}

export function getRealtimeState(): RealtimeState {
  return state;
}

export function useRealtimeState(): RealtimeState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getRealtimeState,
    () => "connecting",
  );
}
