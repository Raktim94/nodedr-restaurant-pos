"use client";

import type { MenuCategoryDto, MenuItemDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  _count: { items: number };
}

export interface KitchenStation {
  id: string;
  name: string;
}

export interface Modifier {
  id: string;
  name: string;
  priceAdjustment: string;
  isDefault: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  modifiers: Modifier[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  stationId: string | null;
  name: string;
  price: string;
  taxRatePercent: string;
  isVeg: boolean;
  isActive: boolean;
  isCombo: boolean;
  category: { id: string; name: string };
  station: { id: string; name: string } | null;
  modifierGroups: { modifierGroup: ModifierGroup }[];
}

export function useCategories(branchId: string | null) {
  return useQuery({
    queryKey: ["menu", "categories", branchId],
    queryFn: () => api.get<MenuCategory[]>(`/menu/categories?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useStations(branchId: string | null) {
  return useQuery({
    queryKey: ["menu", "stations", branchId],
    queryFn: () => api.get<KitchenStation[]>(`/menu/stations?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useMenuItems(branchId: string | null, categoryId?: string) {
  return useQuery({
    queryKey: ["menu", "items", branchId, categoryId],
    queryFn: () =>
      api.get<MenuItem[]>(
        `/menu/items?branchId=${branchId}${categoryId ? `&categoryId=${categoryId}` : ""}`,
      ),
    enabled: !!branchId,
  });
}

export function useCreateCategory(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: MenuCategoryDto) =>
      api.post(`/menu/categories?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu", "categories", branchId] }),
  });
}

export function useCreateMenuItem(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: MenuItemDto) => api.post(`/menu/items?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu", "items", branchId] }),
  });
}

export function useUpdateMenuItem(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<MenuItemDto> }) =>
      api.patch(`/menu/items/${id}?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu", "items", branchId] }),
  });
}

export function useDeleteMenuItem(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/menu/items/${id}?branchId=${branchId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["menu", "items", branchId] }),
  });
}
