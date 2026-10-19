"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";
import { REALTIME_EVENTS, realtimeInvalidations } from "@/lib/realtime-keys";
import { setRealtimeState } from "@/lib/realtime-status";
import { resolveWsUrl } from "@/lib/ws-url";

// One socket connection per mounted consumer, joined to the branch's room
// server-side (see backend RealtimeGateway). Invalidates the relevant
// TanStack Query caches on push events instead of polling — this is what
// lets KDS/table screens update instantly across terminals.
//
// Pushes are not queued for a client that is away, so whenever the socket
// (re)connects after having been down, every cached query is refetched once:
// that is what makes a screen catch up after Wi-Fi drops, a sleeping tablet or
// a server restart instead of showing the state from before the gap.
export function useRealtime(branchId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId) return;

    const socket = io(resolveWsUrl(), { query: { branchId }, withCredentials: true });
    let wasDown = false;

    socket.on("connect", () => {
      setRealtimeState("live");
      if (wasDown) {
        wasDown = false;
        void queryClient.invalidateQueries();
      }
    });
    const down = () => {
      wasDown = true;
      setRealtimeState("offline");
    };
    socket.on("disconnect", down);
    socket.on("connect_error", down);

    for (const event of REALTIME_EVENTS) {
      socket.on(event, () => {
        realtimeInvalidations(event, branchId).forEach((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        );
      });
    }

    return () => {
      socket.disconnect();
      setRealtimeState("connecting");
    };
  }, [branchId, queryClient]);
}
