"use client";

import { useCallback, useEffect, useState } from "react";

export const MUTE_STORAGE_KEY = "nodedr_notifications_muted";
const MUTE_EVENT = "nodedr:notifications-mute-changed";

function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Per-device mute for every notification sound (topbar bell chime + KDS
// ticket chime) — deliberately localStorage, not a synced user preference,
// same reasoning as notification-bell.tsx: a loud kitchen expo screen and a
// quiet back-office laptop are different physical environments.
//
// Shared via a custom window event rather than plain localStorage reads:
// the `storage` event only fires in *other* tabs, so toggling the switch on
// the Settings page wouldn't otherwise reach an already-mounted
// NotificationBell or KDS page in the same tab without a full reload.
export function useNotificationMute(): [boolean, () => void] {
  const [muted, setMuted] = useState(readMuted);

  useEffect(() => {
    const onChange = () => setMuted(readMuted());
    window.addEventListener(MUTE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(MUTE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !readMuted();
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable (private mode / blocked) — event still fires so
      // every mounted consumer in this tab agrees, even without persistence.
    }
    window.dispatchEvent(new Event(MUTE_EVENT));
  }, []);

  return [muted, toggle];
}
