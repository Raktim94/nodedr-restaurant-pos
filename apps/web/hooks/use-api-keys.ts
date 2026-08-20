"use client";

import type { CreateIntegrationApiKeyDto, CreateStaffApiKeyDto, IntegrationScope } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface StaffApiKey {
  id: string;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface StaffApiKeyCreated extends StaffApiKey {
  token: string;
}

export interface IntegrationApiKey {
  id: string;
  name: string;
  lastFour: string;
  branch: { id: string; name: string } | null;
  scopes: IntegrationScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface IntegrationApiKeyCreated extends Omit<IntegrationApiKey, "branch"> {
  token: string;
  branchId: string | null;
}

export function useStaffApiKeys() {
  return useQuery({
    queryKey: ["staff-api-keys"],
    queryFn: () => api.get<StaffApiKey[]>("/staff-api-keys"),
  });
}

export function useCreateStaffApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateStaffApiKeyDto) => api.post<StaffApiKeyCreated>("/staff-api-keys", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-api-keys"] }),
  });
}

export function useRevokeStaffApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/staff-api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-api-keys"] }),
  });
}

export function useIntegrationApiKeys() {
  return useQuery({
    queryKey: ["integration-api-keys"],
    queryFn: () => api.get<IntegrationApiKey[]>("/integration-api-keys"),
  });
}

export function useCreateIntegrationApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateIntegrationApiKeyDto) =>
      api.post<IntegrationApiKeyCreated>("/integration-api-keys", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integration-api-keys"] }),
  });
}

export function useRevokeIntegrationApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/integration-api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integration-api-keys"] }),
  });
}
