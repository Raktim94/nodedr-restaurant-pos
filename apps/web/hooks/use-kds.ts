"use client";

import type { KotStatusDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface KotTicket {
  id: string;
  orderId: string;
  stationId: string | null;
  ticketNumber: string;
  status: KotStatusDto;
  isPriority: boolean;
  createdAt: string;
  station: { id: string; name: string } | null;
  order: {
    orderNumber: string;
    type: string;
    table: { number: string; name: string | null } | null;
  };
  items: {
    id: string;
    orderItem: {
      nameSnapshot: string;
      quantity: number;
      kitchenNote: string | null;
      modifiers: { nameSnapshot: string }[];
    };
  }[];
}

export function useKdsTickets(branchId: string | null) {
  return useQuery({
    queryKey: ["kds", "tickets", branchId],
    queryFn: () => api.get<KotTicket[]>(`/kds/tickets?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 20_000,
  });
}

export function useUpdateKotStatus(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: KotStatusDto }) =>
      api.patch(`/kds/tickets/${id}/status?branchId=${branchId}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kds", "tickets", branchId] }),
  });
}

export const NEXT_STATUS: Partial<Record<KotStatusDto, KotStatusDto>> = {
  NEW: "ACCEPTED",
  ACCEPTED: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
};
