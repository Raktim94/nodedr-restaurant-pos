"use client";

import type { SetComboComponentsDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ComboComponent {
  id: string;
  componentItemId: string;
  quantity: number;
  componentItem: { id: string; name: string; price: string };
}

export function useComboComponents(branchId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: ["menu", "combo-components", itemId, branchId],
    queryFn: () =>
      api.get<ComboComponent[]>(
        `/menu/items/${itemId}/combo-components?branchId=${branchId}`,
      ),
    enabled: !!itemId && !!branchId,
  });
}

export function useSetComboComponents(branchId: string | null, itemId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SetComboComponentsDto) =>
      api.post(`/menu/items/${itemId}/combo-components?branchId=${branchId}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menu", "combo-components", itemId] });
      queryClient.invalidateQueries({ queryKey: ["menu", "items", branchId] });
    },
  });
}
