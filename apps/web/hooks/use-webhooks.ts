"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
}
export interface DeliveryRow {
  id: string;
  event: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

export function useWebhooks() {
  return useQuery({ queryKey: ["webhooks"], queryFn: () => api.get<WebhookRow[]>("/webhooks") });
}
export function useWebhookEvents() {
  return useQuery({ queryKey: ["webhooks", "events"], queryFn: () => api.get<string[]>("/webhooks/events") });
}
export function useWebhookDeliveries(id: string | null) {
  return useQuery({
    queryKey: ["webhooks", "deliveries", id],
    queryFn: () => api.get<DeliveryRow[]>(`/webhooks/${id}/deliveries`),
    enabled: !!id,
    refetchInterval: 10_000,
  });
}

export function useWebhookActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["webhooks"] });
  return {
    create: useMutation({
      mutationFn: (dto: { url: string; events: string[]; description?: string }) =>
        api.post<WebhookRow & { secret: string }>("/webhooks", dto),
      onSuccess: done,
    }),
    setActive: useMutation({
      mutationFn: (v: { id: string; isActive: boolean }) => api.patch(`/webhooks/${v.id}/active`, { isActive: v.isActive }),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/webhooks/${id}`), onSuccess: done }),
    test: useMutation({
      mutationFn: (id: string) =>
        api.post<{ status: string; lastStatusCode: number | null; lastError: string | null }>(`/webhooks/${id}/test`),
      onSuccess: done,
    }),
  };
}
