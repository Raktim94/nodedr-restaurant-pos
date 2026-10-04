"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: ["2fa", "status"],
    queryFn: () => api.get<{ enabled: boolean; recoveryCodesLeft: number }>("/auth/2fa/status"),
  });
}

export function useTwoFactorActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["2fa"] });
  return {
    setup: useMutation({
      mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup"),
    }),
    enable: useMutation({
      mutationFn: (code: string) => api.post<{ recoveryCodes: string[] }>("/auth/2fa/enable", { code }),
      onSuccess: done,
    }),
    disable: useMutation({
      mutationFn: (v: { password: string; code: string }) => api.post("/auth/2fa/disable", v),
      onSuccess: done,
    }),
  };
}
