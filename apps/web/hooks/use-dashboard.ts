"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DashboardSummary {
  todayRevenue: number;
  todayOrders: number;
  channels: { online: number; offline: number };
  tables: {
    available: number;
    occupied: number;
    reserved: number;
    cleaning: number;
    outOfService: number;
  };
  kitchenQueue: { new: number; accepted: number; preparing: number; ready: number };
  /** Bills with money taken and a balance still owed. */
  pendingPayments: { count: number; balance: number };
  /** Role-gated on the server: null when the signed-in role may not see it. */
  lowStock: number | null;
  customers: number | null;
  employees: number | null;
  unpaidPayrollRuns: number | null;
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

export interface DashboardTrends {
  revenue: { date: string; amount: number }[];
  waste: { date: string; cost: number }[];
}

export function useDashboardTrends(branchId: string | null, days = 14) {
  return useQuery({
    queryKey: ["dashboard", "trends", branchId, days],
    queryFn: () => api.get<DashboardTrends>(`/dashboard/trends?branchId=${branchId}&days=${days}`),
    enabled: !!branchId,
    refetchInterval: 60_000,
  });
}

// ---- Personal layout (saved on the server, so it follows the person) -------

export const TOP_WIDGETS = ["kpis", "attention", "charts"] as const;
export const CARD_WIDGETS = ["tables", "kitchen", "recent", "channels"] as const;
export const TREND_DAY_OPTIONS = [7, 14, 30, 90] as const;
export const WIDGET_LABELS: Record<string, string> = {
  kpis: "Key figures",
  attention: "Needs attention",
  charts: "Revenue and waste charts",
  tables: "Tables",
  kitchen: "Kitchen queue",
  recent: "Recent transactions",
  channels: "Order channels",
};

export interface DashboardPrefs {
  topOrder: string[];
  cardOrder: string[];
  hidden: string[];
  trendDays: number;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  topOrder: [...TOP_WIDGETS],
  cardOrder: [...CARD_WIDGETS],
  hidden: [],
  trendDays: 14,
};

export function useDashboardPrefs() {
  return useQuery({
    queryKey: ["dashboard", "preferences"],
    queryFn: () => api.get<DashboardPrefs>("/dashboard/preferences"),
    staleTime: 5 * 60_000,
  });
}

export function useSaveDashboardPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: DashboardPrefs) => api.put<DashboardPrefs>("/dashboard/preferences", prefs),
    // Show the change at once; the server's cleaned copy replaces it on success.
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: ["dashboard", "preferences"] });
      const previous = qc.getQueryData<DashboardPrefs>(["dashboard", "preferences"]);
      qc.setQueryData(["dashboard", "preferences"], prefs);
      return { previous };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.previous) qc.setQueryData(["dashboard", "preferences"], ctx.previous);
    },
    onSuccess: (saved) => qc.setQueryData(["dashboard", "preferences"], saved),
  });
}
