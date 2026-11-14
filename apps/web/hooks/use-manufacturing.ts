"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const q = (b: string | null, extra: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({ branchId: b ?? "" });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
};

export interface MfgSettings {
  enabled: boolean;
  requireTableSession: boolean;
  canPost: boolean;
  canPrice: boolean;
  canReport: boolean;
  canQuality: boolean;
  latest: { entryNo: string; producedAt: string; item: string | null; unit: string | null; unitCost: string | null; quantity: string | null } | null;
}
export const useMfgSettings = (branchId: string | null) =>
  useQuery({ queryKey: ["mfg-settings", branchId], queryFn: () => api.get<MfgSettings>(`/inventory/manufacturing/settings?${q(branchId)}`), enabled: !!branchId, retry: false });

export function useSetMfgEnabled(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (enabled: boolean) => api.patch(`/inventory/manufacturing/settings?${q(branchId)}`, { enabled }), onSuccess: () => qc.invalidateQueries({ queryKey: ["mfg-settings"] }) });
}

export interface PreviewLine { ingredientId: string; name: string; unit: IngredientUnit; quantity: string; rate: string | null; rateSource: string; lineCost: string | null }
export interface Metrics { grossProfit: string; marginPercent: string | null; markupPercent: string | null }
export interface MfgPreview {
  finished: { name: string; unit: string; quantity: string };
  lines: PreviewLine[];
  missingRates: string[];
  shortages: string[];
  costs: { category: string; description: string | null; amount: string; included: boolean }[];
  ingredientCost: string | null;
  additionalCost: string | null;
  totalCost: string | null;
  unitCost: string | null;
  menuItems: { id: string; name: string; price: string }[];
  menuItem: { id: string; name: string } | null;
  currentPrice: string | null;
  currentPriceMetrics: Metrics | null;
  proposedPrice: string | null;
  proposedPriceMetrics: Metrics | null;
  pricesIncludeTax: boolean;
  canPost: boolean;
}

export interface BatchBody {
  producedAt?: Date;
  batchRef?: string;
  manufacturedOn?: Date;
  expiryDate?: Date;
  notes?: string;
  inputs: { ingredientId: string; quantity: string; unit: IngredientUnit; rate?: string }[];
  outputs: { ingredientId: string; quantity: string; unit: IngredientUnit }[];
  costing: { enabled: true; costs: { category: string; description?: string; amount: string; included: boolean }[]; menuPrice?: { menuItemId: string; newPrice: string; expectedCurrentPrice: string } };
}

export const usePreviewBatch = (branchId: string | null) =>
  useMutation({ mutationFn: (b: Pick<BatchBody, "inputs" | "outputs" | "costing">) => api.post<MfgPreview>(`/inventory/manufacturing/preview?${q(branchId)}`, b) });

export const usePrefill = (branchId: string | null) =>
  useMutation({ mutationFn: (v: { ingredientId: string; quantity: string }) => api.get<{ source: string | null; lines: { ingredientId: string; name: string; unit: string; quantity: string }[] }>(`/inventory/manufacturing/prefill/${v.ingredientId}?${q(branchId, { quantity: v.quantity })}`) });

export function usePostBatch(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => { for (const k of ["production", "production-report", "stock-items", "journal", "ingredients", "mfg-settings", "mfg-report"]) void qc.invalidateQueries({ queryKey: [k] }); };
  return {
    post: useMutation({ mutationFn: (b: BatchBody & { idempotencyKey: string }) => api.post<{ id: string; entryNo: string; unitCost: string }>(`/inventory/production?${q(branchId)}`, { ...b, post: true }), onSuccess: done }),
    draft: useMutation({ mutationFn: (b: BatchBody) => api.post<{ id: string; entryNo: string }>(`/inventory/production?${q(branchId)}`, { ...b, post: false }), onSuccess: done }),
  };
}

export type QualityResult = "PASS" | "FAIL" | "NEEDS_REVIEW";

export function useRecordQuality(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; result: QualityResult; grade?: string; notes?: string }) => api.patch(`/inventory/production/${v.id}/quality?${q(branchId)}`, { result: v.result, grade: v.grade, notes: v.notes }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["mfg-report"] }); void qc.invalidateQueries({ queryKey: ["production"] }); },
  });
}

export interface MfgReport {
  note: string;
  batchesByDay: { date: string; batches: number; totalCost: string }[];
  produced: { itemId: string; name: string; unit: string; quantity: string; batches: number; totalCost: string; avgUnitCost: string | null }[];
  consumed: { date: string; itemId: string; name: string; unit: string; quantity: string; cost: string }[];
  additionalByCategory: { category: string; amount: string }[];
  batches: { id: string; entryNo: string; producedAt: string; status: "DRAFT" | "POSTED" | "VOIDED"; item: string | null; itemId: string | null; unit: string | null; quantity: string | null; ingredientCost: string | null; additionalCost: string | null; totalCost: string | null; unitCost: string | null; corrects: string | null; correctedBy: string[]; voidReason: string | null; manufacturedOn: string | null; expiryDate: string | null; batchRef: string | null; sellingPriceAtPost: string | null; priceChange: { oldPrice: string; newPrice: string } | null; quality: { result: QualityResult; grade: string | null; notes: string | null; at: string | null } | null; lines: { role: "INPUT" | "OUTPUT"; item: string; quantity: string; unit: string; rate: string | null; amount: string | null }[]; additionalCosts: { category: string; description: string | null; amount: string; included: boolean }[] }[];
  statusCounts: { status: string; count: number }[];
  priceChanges: { id: string; changedAt: string; item: string; oldPrice: string; newPrice: string; by: string | null; entryNo: string | null; unitCost: string | null }[];
}
export const useMfgReport = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({ queryKey: ["mfg-report", branchId, filters], queryFn: () => api.get<MfgReport>(`/inventory/manufacturing/report?${q(branchId, filters)}`), enabled: !!branchId, retry: false });
export const mfgCsvUrl = (branchId: string | null, section: string, filters: Record<string, string | undefined>) => `/api/v1/inventory/manufacturing/report.csv?${q(branchId, { ...filters, section })}`;
