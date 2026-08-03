"use client";

import type { IssueGiftCardDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

export interface GiftCard {
  id: string;
  code: string;
  initialValue: string;
  balance: string;
  isActive: boolean;
  createdAt: string;
}

export function useGiftCards(branchId: string | null) {
  return useQuery({
    queryKey: ["gift-cards", branchId],
    queryFn: () => api.get<GiftCard[]>(`/gift-cards?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useIssueGiftCard(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: IssueGiftCardDto) => api.post<GiftCard>(`/gift-cards?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gift-cards", branchId] }),
  });
}

export async function lookupGiftCard(branchId: string | null, code: string) {
  try {
    return await api.get<GiftCard>(`/gift-cards/${code}?branchId=${branchId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
