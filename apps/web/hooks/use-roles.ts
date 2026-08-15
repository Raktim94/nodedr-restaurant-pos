"use client";

import type { CreateRoleDto, UpdateRoleDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface RolePermissionEntry {
  key: string;
  label: string;
  category: string;
}

export interface RoleWithPermissions {
  id: string;
  name: string;
  label: string;
  isSystem: boolean;
  createdAt: string;
  permissions: { permission: RolePermissionEntry }[];
}

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<RoleWithPermissions[]>("/roles"),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoleDto) =>
      api.post<RoleWithPermissions>("/roles", dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      // Newly created role must show up in the staff-create role picker too.
      queryClient.invalidateQueries({ queryKey: ["staff", "roles"] });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateRoleDto }) =>
      api.patch<RoleWithPermissions>(`/roles/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "roles"] });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "roles"] });
    },
  });
}
