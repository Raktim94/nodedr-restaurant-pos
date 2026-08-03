"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4001";

// One socket connection per mounted consumer, joined to the branch's room
// server-side (see backend RealtimeGateway). Invalidates the relevant
// TanStack Query caches on push events instead of polling — this is what
// lets KDS/table screens update instantly across terminals.
export function useRealtime(branchId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId) return;

    const socket = io(WS_URL, { query: { branchId }, withCredentials: true });

    const invalidate = (keys: string[][]) => {
      keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    };

    socket.on("kot.created", () => invalidate([["kds"], ["dashboard"]]));
    socket.on("kot.updated", () => invalidate([["kds"], ["dashboard"]]));
    socket.on("table.updated", () => invalidate([["floors", branchId]]));
    socket.on("table.layout.updated", () => invalidate([["floors", branchId]]));
    socket.on("order.created", () => invalidate([["dashboard"], ["floors", branchId]]));
    socket.on("order.updated", () => invalidate([["dashboard"], ["floors", branchId]]));

    return () => {
      socket.disconnect();
    };
  }, [branchId, queryClient]);
}
