"use client";

import type { CreateWaitlistEntryDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface WaitlistEntry {
  id: string;
  customerName: string;
  phone: string | null;
  partySize: number;
  quotedWaitMinutes: number | null;
  notes: string | null;
  status: "WAITING" | "SEATED" | "CANCELLED";
  createdAt: string;
}

export function useWaitlist(branchId: string | null) {
  return useQuery({
    queryKey: ["waitlist", branchId],
    queryFn: () => api.get<WaitlistEntry[]>(`/waitlist?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 20_000,
  });
}

export function useCreateWaitlistEntry(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateWaitlistEntryDto) => api.post(`/waitlist?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["waitlist", branchId] }),
  });
}

export function useSeatWaitlistEntry(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tableId }: { id: string; tableId: string }) =>
      api.post(`/waitlist/${id}/seat?branchId=${branchId}`, { tableId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist", branchId] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
    },
  });
}

export function useCancelWaitlistEntry(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/waitlist/${id}?branchId=${branchId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["waitlist", branchId] }),
  });
}
