"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ActiveSession { id: string; tableId: string; openedAt: string; expiresAt: string; locked: boolean }
export const useActiveSessions = (branchId: string | null, enabled = true) =>
  useQuery({ queryKey: ["table-sessions", branchId], queryFn: () => api.get<ActiveSession[]>(`/tables/sessions?branchId=${branchId}`), enabled: !!branchId && enabled, refetchInterval: 20_000, retry: false });

export function useSessionActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["table-sessions"] });
  return {
    open: useMutation({ mutationFn: (v: { tableId: string; hours?: number }) => api.post<{ code: string; expiresAt: string; tableNumber: string }>(`/tables/${v.tableId}/session?branchId=${branchId}`, { hours: v.hours }), onSuccess: done }),
    close: useMutation({ mutationFn: (tableId: string) => api.delete(`/tables/${tableId}/session?branchId=${branchId}`), onSuccess: done }),
  };
}

export interface RatingsData { count: number; average: number | null; distribution: { stars: number; count: number }[]; items: { id: string; stars: number; comment: string | null; createdAt: string; order: { orderNumber: string; guestName: string | null; type: string } | null }[] }
export const useRatings = (branchId: string | null, from?: string, to?: string) =>
  useQuery({ queryKey: ["ratings", branchId, from, to], queryFn: () => api.get<RatingsData>(`/ratings?branchId=${branchId}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`), enabled: !!branchId, retry: false });
