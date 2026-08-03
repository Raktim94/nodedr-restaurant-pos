"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DashboardSummary {
  todayRevenue: number;
  todayOrders: number;
  tables: {
    available: number;
    occupied: number;
    reserved: number;
    cleaning: number;
    outOfService: number;
  };
  kitchenQueue: { new: number; accepted: number; preparing: number; ready: number };
  recentOrders: {
    id: string;
    orderNumber: string;
    type: string;
    totalAmount: string;
    billedAt: string;
  }[];
}

export function useDashboardSummary(branchId: string | null) {
  return useQuery({
    queryKey: ["dashboard", "summary", branchId],
    queryFn: () => api.get<DashboardSummary>(`/dashboard/summary?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 15_000,
  });
}
