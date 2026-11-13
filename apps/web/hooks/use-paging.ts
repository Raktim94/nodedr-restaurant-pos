"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Buzzer {
  id: string; name: string; number: string | null; tableId: string | null; table: string | null;
  driver: "SIMULATED" | "WEBHOOK"; webhookUrl: string | null; hasSecret: boolean; deviceToken: string; isActive: boolean;
  lastSeenAt: string | null; online: boolean | null; activeCall: { id: string; state: string } | null;
}
export interface CallResult { call: { id: string; state: string; error?: string | null }; duplicate?: boolean; deviceOnline?: boolean | null; buzzer?: { name: string } }

const q = (b: string | null) => `branchId=${b ?? ""}`;

export const useBuzzers = (branchId: string | null) =>
  useQuery({ queryKey: ["buzzers", branchId], queryFn: () => api.get<Buzzer[]>(`/paging/buzzers?${q(branchId)}`), enabled: !!branchId, refetchInterval: 10_000 });

export function useBuzzerActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["buzzers"] });
  return {
    create: useMutation({ mutationFn: (d: Record<string, unknown>) => api.post(`/paging/buzzers?${q(branchId)}`, d), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; data: Record<string, unknown> }) => api.patch(`/paging/buzzers/${v.id}?${q(branchId)}`, v.data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/paging/buzzers/${id}?${q(branchId)}`), onSuccess: done }),
    test: useMutation({ mutationFn: (id: string) => api.post<CallResult>(`/paging/buzzers/${id}/test?${q(branchId)}`), onSuccess: done }),
  };
}

/** Kitchen: this order is ready, page its table. */
export function useCallBuzzer(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { orderId: string; repeat?: boolean }) => api.post<CallResult>(`/paging/orders/${v.orderId}/call?${q(branchId)}`, { repeat: v.repeat }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["buzzers"] }),
  });
}
