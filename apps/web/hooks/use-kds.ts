"use client";

import { KOT_NEXT_STATUS, type KotStatusDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { isNativeApp } from "@/lib/native";
import { isNetworkError, outbox } from "@/lib/outbox";

export interface KotTicket {
  id: string;
  orderId: string;
  stationId: string | null;
  ticketNumber: string;
  status: KotStatusDto;
  isPriority: boolean;
  printedCount: number;
  lastPrintError: string | null;
  createdAt: string;
  station: { id: string; name: string } | null;
  order: {
    orderNumber: string;
    type: string;
    channel: "STAFF" | "ONLINE";
    notes: string | null;
    table: { number: string; name: string | null } | null;
    guestName: string | null;
    customer: { name: string | null; phone: string | null } | null;
  };
  items: {
    id: string;
    orderItem: {
      nameSnapshot: string;
      quantity: number;
      kitchenNote: string | null;
      modifiers: { nameSnapshot: string }[];
    };
  }[];
  /** A change made on this phone is waiting to be sent (set on the phone only). */
  savedOnPhone?: boolean;
}

export function useKdsStations(branchId: string | null) {
  return useQuery({
    queryKey: ["kds", "stations", branchId],
    queryFn: () => api.get<{ id: string; name: string }[]>(`/kds/stations?branchId=${branchId}`),
    enabled: !!branchId,
    staleTime: 60_000,
  });
}

/** stationId "" = every station (the default, and what this screen always did). */
export function useKdsTickets(branchId: string | null, stationId = "", enabled = true) {
  return useQuery({
    queryKey: ["kds", "tickets", branchId, stationId],
    queryFn: () =>
      api.get<KotTicket[]>(
        `/kds/tickets?branchId=${branchId}${stationId ? `&stationId=${encodeURIComponent(stationId)}` : ""}`,
      ),
    enabled: !!branchId && enabled,
    refetchInterval: 20_000,
  });
}

const noPending: never[] = [];
/**
 * The tickets with the changes saved on this phone (not yet sent) laid over
 * them, so the board shows what the cook just did even with no connection -
 * and keeps showing it if a refresh lands before the changes are sent.
 */
export function useKdsTicketsWithPending(tickets: KotTicket[] | undefined) {
  const version = useSyncExternalStore(outbox.subscribe, () => outbox.all().length + ":" + outbox.all().map((i) => i.key).join(), () => "");
  return useMemo(() => {
    const pending = new Map<string, { status?: KotStatusDto; isPriority?: boolean }>();
    for (const i of version ? outbox.all() : noPending) {
      if (i.meta?.kind === "kot-status") pending.set(i.meta.id, { ...pending.get(i.meta.id), status: i.meta.status as KotStatusDto });
      if (i.meta?.kind === "kot-priority") pending.set(i.meta.id, { ...pending.get(i.meta.id), isPriority: i.meta.isPriority });
    }
    const list = (tickets ?? []).map((t) => {
      const p = pending.get(t.id);
      return p ? { ...t, ...(p.status ? { status: p.status } : {}), ...(p.isPriority !== undefined ? { isPriority: p.isPriority } : {}), savedOnPhone: true } : { ...t, savedOnPhone: false };
    });
    // A ticket served offline is done: it leaves the board like it would online.
    return list.filter((t) => t.status !== "SERVED");
  }, [tickets, version]);
}

export function useUpdateKotStatus(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: KotStatusDto }) => {
      const path = `/kds/tickets/${id}/status?branchId=${branchId}`;
      try {
        return await api.patch(path, { status });
      } catch (e) {
        // No connection: keep the step on the phone and send it, in order, when the server is back.
        if (!isNativeApp() || !isNetworkError(e)) throw e;
        outbox.add({
          method: "PATCH",
          path,
          body: { status },
          label: `Ticket ${status.toLowerCase()}`,
          meta: { kind: "kot-status", id, status },
        });
        return null;
      }
    },
    // Also on error: a 409 means the ticket moved on another screen, and the
    // board must show where it really is rather than the stale step.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["kds"] }),
  });
}

export const NEXT_STATUS = KOT_NEXT_STATUS;

/** The kitchen declining a ticket; `confirmStarted` once cooking has begun. */
export function useRejectKot(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, confirmStarted }: { id: string; reason: string; confirmStarted?: boolean }) =>
      api.post(`/kds/tickets/${id}/reject?branchId=${branchId}`, { reason, confirmStarted }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["kds"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
    },
  });
}

export interface IncomingOrder {
  id: string;
  orderNumber: string;
  type: string;
  channel: "STAFF" | "ONLINE";
  guestName: string | null;
  notes: string | null;
  createdAt: string;
  scheduledFor: string | null;
  table: { number: string; name: string | null } | null;
  customer: { name: string | null; phone: string | null } | null;
  items: {
    id: string;
    nameSnapshot: string;
    quantity: number;
    kitchenNote: string | null;
    modifiers: { nameSnapshot: string }[];
  }[];
}

/** Orders waiting for a yes/no. Only fetched for users who may answer them. */
export function useKdsIncoming(branchId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["kds", "incoming", branchId],
    queryFn: () => api.get<IncomingOrder[]>(`/kds/incoming?branchId=${branchId}`),
    enabled: !!branchId && enabled,
    refetchInterval: 15_000,
  });
}

function invalidateAfterAnswer(queryClient: ReturnType<typeof useQueryClient>, branchId: string | null) {
  queryClient.invalidateQueries({ queryKey: ["kds"] });
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
}

export function useAcceptIncoming(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.post(`/kds/incoming/${orderId}/accept?branchId=${branchId}`),
    onSettled: () => invalidateAfterAnswer(queryClient, branchId),
  });
}

export function useDeclineIncoming(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      api.post(`/kds/incoming/${orderId}/reject?branchId=${branchId}`, { reason }),
    onSettled: () => invalidateAfterAnswer(queryClient, branchId),
  });
}

export interface KitchenProgressTicket {
  id: string;
  orderId: string;
  status: KotStatusDto;
  createdAt: string;
  readyAt: string | null;
  order: {
    orderNumber: string;
    type: string;
    table: { id: string; number: string; name: string | null } | null;
  };
}

/** Where each live ticket is - for order-taking screens, no guest details. */
export function useKdsProgress(branchId: string | null) {
  return useQuery({
    queryKey: ["kds", "progress", branchId],
    queryFn: () => api.get<KitchenProgressTicket[]>(`/kds/progress?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 20_000,
  });
}

export function useSetKotPriority(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isPriority }: { id: string; isPriority: boolean }) => {
      const path = `/kds/tickets/${id}/priority?branchId=${branchId}`;
      try {
        return await api.patch(path, { isPriority });
      } catch (e) {
        if (!isNativeApp() || !isNetworkError(e)) throw e;
        outbox.add({
          method: "PATCH",
          path,
          body: { isPriority },
          label: isPriority ? "Ticket starred" : "Ticket unstarred",
          group: `kot-priority:${id}`,
          meta: { kind: "kot-priority", id, isPriority },
        });
        return null;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kds", "tickets", branchId] }),
  });
}

/** `reprint` false = first print (409 if already printed); true = extra copy stamped REPRINT. */
export function useReprintKot(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reprint }: { id: string; reprint: boolean }) =>
      api.post(`/kds/tickets/${id}/${reprint ? "reprint" : "print"}?branchId=${branchId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kds", "tickets", branchId] }),
  });
}

export interface KitchenPerformanceRow {
  stationId: string;
  stationName: string;
  ticketsReady: number;
  avgMinutesToReady: number;
}

export function useKitchenPerformance(branchId: string | null) {
  return useQuery({
    queryKey: ["kds", "performance", branchId],
    queryFn: () => api.get<KitchenPerformanceRow[]>(`/kds/performance?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 60_000,
  });
}
