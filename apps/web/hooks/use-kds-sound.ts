"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { toast } from "sonner";
import { useNotificationMute } from "./use-notification-mute";
import { playNotificationFeedback } from "@/lib/notification-feedback";
import { resolveWsUrl } from "@/lib/ws-url";

// Kitchen-specific sound+toast alert on every new ticket (`kot.created`),
// separate from the topbar notification bell: a KDS terminal is a shared
// kitchen screen that may not be logged in as a user holding kds.manage (so
// it may never receive a `notification.created` push at all), and kitchen
// staff need an audible alert even when they're not looking at the screen
// — spotting a new card in the "New" column later isn't enough. Shares the
// same per-device mute as the bell/Settings toggle (use-notification-mute)
// rather than a separate KDS-only mute, so muting this device once covers
// both surfaces.
export function useKdsSound(branchId: string | null) {
  const [muted] = useNotificationMute();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (!branchId) return;

    const socket = io(resolveWsUrl(), { query: { branchId }, withCredentials: true });

    socket.on("kot.created", () => {
      if (!mutedRef.current) playNotificationFeedback();
      toast("New kitchen ticket", {
        description: "A new ticket just landed on the queue.",
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [branchId]);
}
