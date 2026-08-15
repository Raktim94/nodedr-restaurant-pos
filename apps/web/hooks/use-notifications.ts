"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface NotificationEntry {
  id: string;
  branchId: string;
  recipientUserId: string | null;
  type: string;
  title: string;
  body: string;
  entity: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: NotificationEntry[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const QUERY_KEY = ["notifications"];

// Polls at a modest interval as a fallback in case a socket event is
// missed (tab was backgrounded, brief disconnect) — the actual "instant"
// path is `notification.created` in notification-bell.tsx invalidating
// this same query key on receipt.
export function useNotifications() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<NotificationPage>("/notifications?pageSize=20"),
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<NotificationEntry>(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.patch<{ ok: true }>("/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
