"use client";

import type {
  BulkTableCreateDto,
  BulkTableUpdateDto,
  TableDto,
  TableLayoutUpdateDto,
  TableStatusDto,
  TableUpdateDto,
} from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface RestaurantTable {
  id: string;
  floorId: string;
  number: string;
  name: string | null;
  capacity: number;
  status: TableStatusDto;
  statusSince: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: "square" | "round" | "rect" | "booth" | "counter" | "other";
  qrToken: string | null;
  assignedWaiter: { id: string; name: string } | null;
}

export interface Floor {
  id: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
  layouts?: { id: string; name: string; isActive: boolean }[];
  tables: RestaurantTable[];
}

export function useFloors(branchId: string | null, forEditing = false) {
  return useQuery({
    queryKey: ["floors", branchId, forEditing],
    queryFn: () => api.get<Floor[]>(`/tables/floors?branchId=${branchId}${forEditing ? "&edit=1" : ""}`),
    enabled: !!branchId,
    refetchInterval: 10_000,
  });
}

export function useCreateFloor(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post(`/tables/floors?branchId=${branchId}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useUpdateFloor(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/tables/floors/${id}?branchId=${branchId}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useCreateTable(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: TableDto) => api.post(`/tables?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useBulkCreateTables(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: Omit<BulkTableCreateDto, "columns"> & { columns?: number }) => api.post(`/tables/bulk?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useUpdateTable(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: TableUpdateDto }) =>
      api.patch(`/tables/${id}?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useUpdateTableLayout(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: TableLayoutUpdateDto[]) =>
      api.patch(`/tables/layout?branchId=${branchId}`, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useDeleteTable(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tables/${id}?branchId=${branchId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useUpdateTableStatus(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TableStatusDto }) =>
      api.patch(`/tables/${id}/status?branchId=${branchId}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useRotateQrToken(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<RestaurantTable>(`/tables/${id}/qr-token?branchId=${branchId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useBulkUpdateTables(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BulkTableUpdateDto) => api.patch(`/tables/bulk?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useBulkDeleteTables(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post(`/tables/bulk-delete?branchId=${branchId}`, { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] }),
  });
}

export function useLayoutActions(branchId: string | null) {
  const queryClient = useQueryClient();
  const done = () => queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
  return {
    save: useMutation({ mutationFn: (v: { floorId: string; name: string }) => api.post(`/tables/floors/${v.floorId}/layouts?branchId=${branchId}`, { name: v.name }), onSuccess: done }),
    activate: useMutation({ mutationFn: (id: string) => api.post(`/tables/layouts/${id}/activate?branchId=${branchId}`), onSuccess: done }),
    overwrite: useMutation({ mutationFn: (id: string) => api.post(`/tables/layouts/${id}/save-current?branchId=${branchId}`), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/tables/layouts/${id}?branchId=${branchId}`), onSuccess: done }),
  };
}
