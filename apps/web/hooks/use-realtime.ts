"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";
import { REALTIME_EVENTS, realtimeInvalidations } from "@/lib/realtime-keys";
import { resolveWsUrl } from "@/lib/ws-url";

// One socket connection per mounted consumer, joined to the branch's room
// server-side (see backend RealtimeGateway). Invalidates the relevant
// TanStack Query caches on push events instead of polling — this is what
// lets KDS/table screens update instantly across terminals.
export function useRealtime(branchId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId) return;

    const socket = io(resolveWsUrl(), { query: { branchId }, withCredentials: true });

    for (const event of REALTIME_EVENTS) {
      socket.on(event, () => {
        realtimeInvalidations(event, branchId).forEach((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        );
      });
    }

    return () => {
      socket.disconnect();
    };
  }, [branchId, queryClient]);
}
