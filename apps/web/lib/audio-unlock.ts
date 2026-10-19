// Browsers only let a page make sound after the person has touched it. The
// kitchen screen is often loaded and then left alone, so the first new-ticket
// beep would be silently dropped. One shared AudioContext is created and
// resumed on the first tap/key anywhere on the page, and the KDS offers an
// explicit "enable sound" button for screens nobody has touched yet.
import { useSyncExternalStore } from "react";

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
let installed = false;

function ContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function emit() {
  listeners.forEach((l) => l());
}

/** The shared context if it exists and is allowed to play right now. */
export function runningAudioContext(): AudioContext | null {
  return ctx && ctx.state === "running" ? ctx : null;
}

export function isAudioUnlocked(): boolean {
  return runningAudioContext() !== null;
}

/** Create/resume the shared context. Call from a user gesture. */
export async function unlockAudio(): Promise<boolean> {
  const Ctx = ContextCtor();
  if (!Ctx) return false;
  try {
    ctx ??= new Ctx();
    ctx.addEventListener("statechange", emit);
    if (ctx.state !== "running") await ctx.resume();
  } catch {
    return false;
  }
  emit();
  return ctx.state === "running";
}

/** Unlock on the first touch/click/key; safe to call more than once. */
export function installAudioUnlock() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const once = () => {
    void unlockAudio().then((ok) => {
      if (ok) {
        window.removeEventListener("pointerdown", once);
        window.removeEventListener("keydown", once);
      }
    });
  };
  window.addEventListener("pointerdown", once);
  window.addEventListener("keydown", once);
}

export function useAudioUnlocked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isAudioUnlocked,
    () => false,
  );
}
