"use client";

import { clearOfflineCache } from "@/lib/offline-cache";
import { permissionSatisfied, type LoginDto, type RegisterDto, type SessionUser } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { savedPushToken, savePushToken } from "@/lib/native";
import { api } from "@/lib/api";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<{ user: SessionUser }>("/auth/me"),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: LoginDto) => api.post<{ user: SessionUser }>("/auth/login", dto),
    onSuccess: (data) => {
      // Anything cached before this login belongs to nobody (or to the previous
      // user): drop it so branches and the rest load fresh for this account.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      queryClient.setQueryData(["auth", "me"], data);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: RegisterDto) => api.post<{ user: SessionUser }>("/auth/register", dto),
    onSuccess: (data) => {
      queryClient.setQueryData(["auth", "me"], data);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Stop pushes to this phone before the session ends.
      const token = savedPushToken();
      if (token) {
        await api.delete(`/devices/${encodeURIComponent(token)}`).catch(() => undefined);
        savePushToken(null);
      }
      return api.post("/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      clearOfflineCache();
    },
  });
}

export function hasPermission(user: SessionUser | undefined, permission: string): boolean {
  return user ? permissionSatisfied(user.permissions, permission) : false;
}
