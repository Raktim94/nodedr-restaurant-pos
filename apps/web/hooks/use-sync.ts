"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SyncStatus {
  enabled: boolean;
  role: "client" | "server";
  serverUrl: string | null;
  hasKey: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingChanges: number;
  conflicts: { tbl: string; pk: string; error: string; at: string }[];
}

export interface SyncConnection {
  serverUrl: string;
  apiKey: string;
}

export function useSyncStatus() {
  return useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 10_000,
  });
}

export function useTestSync() {
  return useMutation({
    mutationFn: (body: SyncConnection) => api.post<{ ok: boolean }>("/sync/test", body),
  });
}

export function useEnableSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncConnection & { mode: "adopt" | "merge" }) =>
      api.put<SyncStatus>("/sync/settings", body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}

export function useSyncNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncStatus & { pulled: number; pushed: number }>("/sync/run"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}

export function useDisableSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SyncStatus>("/sync/disable"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sync"] }),
  });
}
