"use client";

import type { RestoreBackupDto, SetBackupConfigDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type BackupStatusValue = "PENDING" | "VERIFIED" | "FAILED";

export interface BackupEntry {
  id: string;
  status: BackupStatusValue;
  sizeBytes: number | null;
  s3KeyDb: string | null;
  s3KeyUploads: string | null;
  sha256: string | null;
  triggeredById: string | null;
  failureReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export interface BackupStatus {
  configured: boolean;
  source: "database" | "environment" | null;
  endpoint: string | null;
  bucket: string | null;
  region: string | null;
  accessKeyIdMasked: string | null;
  intervalDays: number;
  retainCount: number;
  lastBackup: BackupEntry | null;
  nextScheduledAt: string | null;
}

export function useBackupStatus() {
  return useQuery({
    queryKey: ["backups", "status"],
    queryFn: () => api.get<BackupStatus>("/backups/status"),
  });
}

export function useBackups() {
  return useQuery({
    queryKey: ["backups", "list"],
    queryFn: () => api.get<BackupEntry[]>("/backups"),
    // Backups can take a while to move from PENDING to VERIFIED/FAILED —
    // poll gently while the list is on screen so the status column updates
    // itself instead of requiring a manual refresh.
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === "PENDING") ? 5000 : false,
  });
}

export function useSetBackupConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SetBackupConfigDto) =>
      api.post<BackupStatus>("/backups/config", dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useClearBackupConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<BackupStatus>("/backups/config"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useTriggerBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupEntry>("/backups"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: RestoreBackupDto }) =>
      api.post<{ ok: true; restoredFrom: string }>(`/backups/${id}/restore`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

// Not a TanStack Query hook — the download endpoint streams a zip, not
// JSON, so it's a plain browser navigation (`<a href download>`), not a
// `fetch` + blob round-trip. The httpOnly session cookie rides along
// automatically on a same-origin navigation, same as every other
// credentialed request `lib/api.ts` makes.
export function backupDownloadUrl(id: string): string {
  return `/api/v1/backups/${id}/download`;
}
