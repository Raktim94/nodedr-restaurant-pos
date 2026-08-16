"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io } from "socket.io-client";

// NEXT_PUBLIC_* vars are inlined at build time, so a literal default here
// would bake in whatever host built the bundle (e.g. "localhost") — every
// OTHER device on the LAN (another till, a tablet) would then try to reach
// its OWN localhost instead of the actual server, silently breaking
// realtime push on every device but the one that ran `next build`. Falling
// back to the browser's own current hostname at connect time instead means
// this works correctly from any device that loaded the page from the real
// server address, with no per-deployment env var required.
function resolveWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4001`;
  }
  return "http://localhost:4001";
}

// One socket connection per mounted consumer, joined to the branch's room
// server-side (see backend RealtimeGateway). Invalidates the relevant
// TanStack Query caches on push events instead of polling — this is what
// lets KDS/table screens update instantly across terminals.
export function useRealtime(branchId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId) return;

    const socket = io(resolveWsUrl(), { query: { branchId }, withCredentials: true });

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
