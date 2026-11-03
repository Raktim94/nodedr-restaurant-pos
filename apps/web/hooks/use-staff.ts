"use client";

import type { CreateStaffDto, UpdateStaffDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  roleId: string;
  role: { id: string; name: string; label: string };
  branches: { branch: { id: string; name: string } }[];
  departmentId: string | null;
  department: { id: string; name: string } | null;
  permissionOverrides: PermissionOverride[];
}

export interface PermissionOverride {
  effect: "GRANT" | "DENY";
  reason: string | null;
  expiresAt: string | null;
  permission: { key: string };
}

export interface Department {
  id: string;
  name: string;
  _count: { users: number };
}

export interface StaffRole {
  id: string;
  name: string;
  label: string;
}

export function useStaff() {
  return useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get<StaffMember[]>("/users"),
  });
}

export function useStaffRoles() {
  return useQuery({
    queryKey: ["staff", "roles"],
    queryFn: () => api.get<StaffRole[]>("/users/roles"),
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateStaffDto) => api.post<StaffMember>("/users", dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateStaffDto }) =>
      api.patch<StaffMember>(`/users/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useDeleteStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: ["staff", "departments"],
    queryFn: () => api.get<Department[]>("/users/departments"),
  });
}

export function useDepartmentActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["staff"] });
  };
  return {
    create: useMutation({
      mutationFn: (name: string) => api.post("/users/departments", { name }),
      onSuccess: refresh,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api.patch(`/users/departments/${id}`, { name }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/users/departments/${id}`),
      onSuccess: refresh,
    }),
  };
}

export interface OverrideInput {
  permissionKey: string;
  effect: "GRANT" | "DENY";
  reason?: string;
  expiresAt?: string;
}

export function useSetPermissionOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides: OverrideInput[] }) =>
      api.put<StaffMember>(`/users/${id}/permission-overrides`, { overrides }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}
