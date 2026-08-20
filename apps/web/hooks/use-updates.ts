"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: string;
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: ["system", "update-check"],
    queryFn: () => api.get<VersionInfo>("/system/update/check"),
    // The backend caches this for an hour too — refetching more often than
    // that on the client just re-hits the same cached response.
    staleTime: 5 * 60 * 1000,
  });
}

export function useApplyUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: string; message: string }>("/system/update/apply"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system", "update-check"] });
    },
  });
}
