"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useNotificationMute } from "./use-notification-mute";
import { playNotificationFeedback } from "@/lib/notification-feedback";
import { resolveWsUrl } from "@/lib/ws-url";

// Kitchen-specific sound alert for a new ticket (`kot.created`) and for an
// incoming order that is waiting to be accepted (`order.created` with
// acceptance PENDING - it has no ticket yet, so without this the kitchen
// would never be told). Separate from the topbar notification bell: a KDS
// terminal is a shared kitchen screen that may not be logged in as a user
// holding kds.manage (so it may never receive a `notification.created` push
// at all), and kitchen staff need an audible alert even when they're not
// looking at the screen. Shares the same per-device mute as the bell/Settings
// toggle (use-notification-mute) rather than a separate KDS-only mute.
//
// Browsers refuse sound until the page has been touched; see audio-unlock.ts
// and the "turn on sound" button in components/kds/live-status.tsx. The
// visual cue (a pulsing new ticket / the Incoming strip) does not depend on
// sound at all.
export function useKdsSound(branchId: string | null) {
  const [muted] = useNotificationMute();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!branchId) return;

    const socket = io(resolveWsUrl(), { query: { branchId }, withCredentials: true });
    const chime = () => {
      if (!mutedRef.current) playNotificationFeedback();
    };

    socket.on("kot.created", chime);
    socket.on("order.created", (payload: { acceptance?: string } | undefined) => {
      if (payload?.acceptance === "PENDING") chime();
    });

    return () => {
      socket.disconnect();
    };
  }, [branchId]);
}
