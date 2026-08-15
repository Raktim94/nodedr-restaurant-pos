"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface AuditLogActor {
  id: string;
  name: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  user: AuditLogActor | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditLogPage {
  data: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditLogFilters {
  entity?: string;
  action?: string;
  userId?: string;
  /** yyyy-mm-dd, inclusive */
  from?: string;
  /** yyyy-mm-dd, inclusive */
  to?: string;
  page: number;
  pageSize: number;
}

function buildQuery(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (filters.entity) params.set("entity", filters.entity);
  if (filters.action) params.set("action", filters.action);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return params.toString();
}

export function useAuditLog(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ["audit-log", filters],
    queryFn: () => api.get<AuditLogPage>(`/audit-logs?${buildQuery(filters)}`),
    // Keep the previous page's rows on screen while the next page loads
    // instead of flashing a skeleton on every pagination click.
    placeholderData: (previous) => previous,
  });
}

export function useAuditLogEntities() {
  return useQuery({
    queryKey: ["audit-log", "entities"],
    queryFn: () => api.get<string[]>("/audit-logs/entities"),
  });
}
