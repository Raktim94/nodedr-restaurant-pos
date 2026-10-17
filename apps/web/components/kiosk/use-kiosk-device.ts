"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Browser online/offline flag. navigator.onLine can be wrong in one
 *  direction (online but server unreachable), which the API error states
 *  cover; "offline" from the browser is reliable enough to act on. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

// Keeps the screen on, but only via the standard Screen Wake Lock API and
// only after a real tap (browsers require a user gesture), i.e. the
// customer's/staff's "Start" press. Unsupported browsers (or plain-HTTP LAN
// origins, where the API is hidden) silently do nothing; the supported
// permanent approach is the device's own kiosk/stay-awake setting (see
// docs/KIOSK-AND-KDS.md). Re-acquired when the tab becomes visible again.
export function useScreenAwake() {
  const lock = useRef<WakeLockSentinel | null>(null);
  const wanted = useRef(false);

  const acquire = useCallback(async () => {
    try {
      if (!wanted.current || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      if (lock.current && !lock.current.released) return;
      lock.current = await navigator.wakeLock.request("screen");
    } catch {
      // Denied (battery saver, no gesture, insecure origin): not an error.
    }
  }, []);

  useEffect(() => {
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock.current?.release().catch(() => {});
    };
  }, [acquire]);

  return useCallback(() => {
    wanted.current = true;
    void acquire();
  }, [acquire]);
}

/** Registers the kiosk service worker (static shell only; see sw route). */
export function useKioskServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/kiosk/sw.js", { scope: "/kiosk/" })
      .catch(() => {
        // Insecure origin or blocked: the kiosk works the same, just no offline shell.
      });
  }, []);
}

/** Calls onIdle after `limitMs` without any touch/key/pointer activity while active. */
export function useIdle(active: boolean, limitMs: number, onIdle: () => void) {
  const last = useRef(0);
  const cb = useRef(onIdle);
  useEffect(() => {
    cb.current = onIdle;
  });
  useEffect(() => {
    if (!active) return;
    last.current = Date.now();
    const bump = () => {
      last.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last.current >= limitMs) {
        last.current = Date.now();
        cb.current();
      }
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(timer);
    };
  }, [active, limitMs]);
}
