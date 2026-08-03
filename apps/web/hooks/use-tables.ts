"use client";

import type { TableDto, TableStatusDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface RestaurantTable {
  id: string;
  floorId: string;
  number: string;
  name: string | null;
  capacity: number;
  status: TableStatusDto;
  posX: number;
  posY: number;
  width: number;
  height: number;
  assignedWaiter: { id: string; name: string } | null;
}

export interface Floor {
  id: string;
  name: string;
  sortOrder: number;
  tables: RestaurantTable[];
}

export function useFloors(branchId: string | null) {
  return useQuery({
    queryKey: ["floors", branchId],
    queryFn: () => api.get<Floor[]>(`/tables/floors?branchId=${branchId}`),
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

export function useCreateTable(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: TableDto) => api.post(`/tables?branchId=${branchId}`, dto),
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
