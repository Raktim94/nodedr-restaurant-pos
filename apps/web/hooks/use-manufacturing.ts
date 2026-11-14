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

// ---- manufacturing journal v2 ----------------------------------------------------------------------------

export interface RecipeLine { ingredientId: string; name: string; quantity: string; unit: IngredientUnit }
export interface Recipe {
  kind: "RECIPE" | "MENU"; id: string; name: string; version: number; isActive: boolean; notes: string | null;
  outputIngredientId: string; outputName: string; outputUnit: IngredientUnit; baseOutputQty: string; lines: RecipeLine[];
}
export const useRecipes = (branchId: string | null, productId?: string, all = false) =>
  useQuery({ queryKey: ["recipes", branchId, productId ?? "", all], queryFn: () => api.get<Recipe[]>(`/inventory/recipes?${q(branchId, { productId, all: all ? "1" : undefined })}`), enabled: !!branchId });

export interface RecipeFill { recipe: { kind: string; id: string; name: string; version: number; baseOutputQty: string; outputUnit: string }; plannedOutput: string; lines: { ingredientId: string; name: string; unit: IngredientUnit; quantity: string; stockUnit: string }[] }
export const useRecipeFill = (branchId: string | null) =>
  useMutation({ mutationFn: (v: { kind: string; id: string; quantity: string }) => api.get<RecipeFill>(`/inventory/recipes/fill?${q(branchId, { kind: v.kind, id: v.id, quantity: v.quantity })}`) });

export interface RecipeBody { outputIngredientId: string; name: string; baseOutputQty: string; notes?: string; lines: { ingredientId: string; quantity: string; unit: IngredientUnit }[] }
export function useRecipeMutations(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["recipes"] });
  return {
    create: useMutation({ mutationFn: (b: RecipeBody) => api.post<Recipe>(`/inventory/recipes?${q(branchId)}`, b), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; body: RecipeBody }) => api.patch<Recipe>(`/inventory/recipes/${v.id}?${q(branchId)}`, v.body), onSuccess: done }),
    setActive: useMutation({ mutationFn: (v: { id: string; isActive: boolean }) => api.post(`/inventory/recipes/${v.id}/active?${q(branchId)}`, { isActive: v.isActive }), onSuccess: done }),
  };
}

export interface VoucherPreview {
  costed: boolean; rateBasis: string; wastageTreatment: string;
  inputs: { ingredientId: string; name: string; unit: string; quantity: string; onHand: string; atLocation: string | null; location: string | null; rate: string | null; rateSource: string; lineCost: string | null; expected: string | null; variance: string | null; variancePercent: string | null }[];
  outputs: { ingredientId: string; name: string; unit: string; good: string; rejected: string; rejectRate: string; location: string | null; expected: string | null; yieldPercent: string | null; percent: string | null; directMaterial: string | null; allocatedCost: string | null; unitCost: string | null }[];
  ingredientCost: string | null; additionalCost: string | null; recovery: string; totalCost: string | null;
  method: string | null; costError: string | null; shortages: string[]; canPost: boolean;
}
export const useVoucherPreview = (branchId: string | null) =>
  useMutation({ mutationFn: (b: unknown) => api.post<VoucherPreview>(`/inventory/production/voucher-preview?${q(branchId)}`, b) });

export interface DailyVoucher {
  id: string; entryNo: string; producedAt: string; date: string; batchRef: string | null; notes: string | null; sourcePo: string | null; sourceSupplier: string | null;
  recipe: { name: string; kind: string | null; baseOutputQty: string | null } | null; costed: boolean;
  ingredientCost: string | null; additionalCost: string | null; totalCost: string | null; allocationMethod: string | null;
  additionalCosts: { category: string; description: string | null; amount: string | null; included: boolean }[];
  quality: { result: string; grade: string | null; notes: string | null } | null;
  inputs: { ingredientId: string; name: string; unit: string; enteredQuantity: string; quantity: string; rate: string | null; cost: string | null; expected: string | null; variance: string | null; variancePercent: string | null; location: string | null; lot: string | null; directTo: string | null }[];
  outputs: { ingredientId: string; name: string; unit: string; good: string; rejected: string; rejectRate: string; expected: string | null; yieldPercent: string | null; percent: string | null; allocatedCost: string | null; unitCost: string | null; location: string | null; lot: string | null }[];
}
export interface DailyTotals { vouchers: number; totalCost: string; consumed: { ingredientId: string; name: string; unit: string; quantity: string; cost: string }[]; produced: { ingredientId: string; name: string; unit: string; good: string; rejected: string; allocatedCost: string; unitCost: string | null }[] }
export interface DailyReport { timezone: string; note: string; days: (DailyTotals & { date: string; vouchers: DailyVoucher[] })[]; totals: DailyTotals }
export const useDailyReport = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({ queryKey: ["mfg-daily", branchId, filters], queryFn: () => api.get<DailyReport>(`/inventory/manufacturing/daily?${q(branchId, filters)}`), enabled: !!branchId, retry: false });
export const dailyCsvUrl = (branchId: string | null, filters: Record<string, string | undefined>) => `/api/v1/inventory/manufacturing/daily.csv?${q(branchId, filters)}`;
export const analysisCsvUrl = (branchId: string | null, filters: Record<string, string | undefined>) => `/api/v1/inventory/manufacturing/analysis.csv?${q(branchId, filters)}`;

export interface AnalysisBatch { voucherId: string; entryNo: string; date: string; batchRef: string | null; recipe: string | null; good: string; rejected: string; rejectRate: string; expected: string | null; yieldPercent: string | null; allocatedCost: string | null; unitCost: string | null; quality: string | null; ingredients: { name: string; unit: string; actual: string; expected: string | null; variancePercent: string | null; per100Good: string | null; expectedPer100: string | null }[] }
export interface Analysis { note: string; products: { productId: string; name: string; unit: string; batches: AnalysisBatch[]; dailyCost: { date: string; good: string; allocatedCost: string; weightedUnitCost: string | null }[] }[] }
export const useAnalysis = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({ queryKey: ["mfg-analysis", branchId, filters], queryFn: () => api.get<Analysis>(`/inventory/manufacturing/analysis?${q(branchId, filters)}`), enabled: !!branchId, retry: false });

export interface MenuCost { menuItemId: string; name: string; price: string; costPerPortion: string; costDate: string; isToday: boolean; batches: number; indicativeDifference: string }
export const useMenuCosts = (branchId: string | null) =>
  useQuery({ queryKey: ["menu-costs", branchId], queryFn: () => api.get<{ today: string; items: MenuCost[] }>(`/inventory/manufacturing/menu-costs?${q(branchId)}`), enabled: !!branchId, retry: false, staleTime: 60_000 });
