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
