"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface PosDevice {
  id: string;
  deviceId: string;
  name: string;
  platform: string | null;
  appVersion: string | null;
  enrolledAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  pendingCount: number;
  failedCount: number;
  lastError: string | null;
  revokedAt: string | null;
  user: { id: string; name: string };
}

export const usePosDevices = () =>
  useQuery({ queryKey: ["pos-devices"], queryFn: () => api.get<PosDevice[]>("/pos-devices"), refetchInterval: 30_000 });

export function useDeviceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; action: "revoke" | "restore" }) => api.post(`/pos-devices/${v.id}/${v.action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos-devices"] }),
  });
}
