"use client";

import type {
  CostIngredient,
  CostPreparation,
  CostUnit,
  Overhead,
  PriceSuggestion,
  Profitability,
  RecipeCost,
  TaxModeCost,
  MarginAlert,
} from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DishCostView {
  costPerPortion: number | null;
  source: "RECIPE" | "STOCK_ITEM" | "NONE";
  recipeCost: RecipeCost | null;
  stockItem: { ingredientId: string; name: string; unitCost: number | null; quantityPerSale: number; label: string } | null;
  overheadPerPortion: number;
  complete: boolean;
}

export interface CostedOption {
  id: string;
  groupName: string;
  name: string;
  priceAdjustment: number;
  lines: { ingredientId: string; quantity: number; unit: CostUnit | null }[];
  cost: number | null;
  complete: boolean;
  hasIngredients: boolean;
}

export interface MenuItemCostingView {
  menuItemId: string;
  name: string;
  isCombo: boolean;
  taxMode: TaxModeCost;
  taxRatePercent: number;
  price: number;
  halfPrice: number | null;
  tracking: { inventoryTracking: "NONE" | "RECIPE" | "DIRECT"; stockIngredientId: string | null; stockQuantityPerSale: number };
  version: number;
  config: {
    batchOutputQty: number;
    overheads: Overhead[];
    halfPortionRatio: number;
    targetMarginPercent: number | null;
    targetMarkupPercent: number | null;
    alertDropPoints: number;
    baselineCost: number | null;
    baselineAt: string | null;
  };
  lines: { ingredientId: string; quantity: number; unit?: CostUnit | null }[];
  cost: DishCostView;
  profitability: Profitability | null;
  suggestions: { margin: PriceSuggestion | null; markup: PriceSuggestion | null };
  alert: MarginAlert;
  half: { ratio: number; costPerPortion: number | null; profit: Profitability | null; alert: MarginAlert } | null;
  modifiers: CostedOption[];
}

export interface CostingOverviewRow {
  menuItemId: string;
  name: string;
  category: string;
  price: number;
  source: "RECIPE" | "STOCK_ITEM" | "NONE";
  costPerPortion: number | null;
  complete: boolean;
  foodCostPercent: number | null;
  grossMarginPercent: number | null;
  grossProfit: number | null;
  alert: "OK" | "WATCH" | "LOSS" | "UNKNOWN";
  alertMessage: string;
  targetMarginPercent: number | null;
}

export interface CostingOverview {
  taxMode: TaxModeCost;
  items: CostingOverviewRow[];
  alerts: CostingOverviewRow[];
  unpriced: number;
  withoutRecipe: number;
}

export interface CostingBundle {
  generatedAt: string;
  taxMode: TaxModeCost;
  ingredients: (CostIngredient & { kind: "PURCHASED" | "PREPARED"; currentStock: number; version: number })[];
  items: unknown[];
  modifiers: unknown[];
}

export interface PreparationView {
  id: string;
  preparationId: string;
  name: string;
  unit: CostUnit;
  version: number;
  batchOutputQty: number;
  overheads: Overhead[];
  lines: { ingredientId: string; quantity: number; unit: CostUnit | null }[];
  cost: RecipeCost;
  currentStock: number;
  averageCostPerUnit: number;
  runs?: { id: string; batches: number; outputQty: number; totalCost: number; unitCost: number; note: string | null; createdAt: string }[];
}

const key = (...k: unknown[]) => ["costing", ...k];

export function useCostingBundle(branchId: string | null, enabled = true) {
  return useQuery({
    queryKey: key("bundle", branchId),
    queryFn: () => api.get<CostingBundle>(`/costing/bundle?branchId=${branchId}`),
    enabled: !!branchId && enabled,
    staleTime: 30_000,
  });
}

export function useCostingOverview(branchId: string | null) {
  return useQuery({
    queryKey: key("overview", branchId),
    queryFn: () => api.get<CostingOverview>(`/costing/overview?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useMenuItemCosting(branchId: string | null, menuItemId: string | null) {
  return useQuery({
    queryKey: key("item", branchId, menuItemId),
    queryFn: () => api.get<MenuItemCostingView>(`/costing/menu-items/${menuItemId}?branchId=${branchId}`),
    enabled: !!branchId && !!menuItemId,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["costing"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["menu"] });
  };
}

export interface SaveCostingInput {
  lines: { ingredientId: string; quantity: number; unit?: CostUnit | null }[];
  batchOutputQty: number;
  overheads: Overhead[];
  halfPortionRatio: number;
  targetMarginPercent: number | null;
  targetMarkupPercent: number | null;
  alertDropPoints: number;
  baseVersion?: number;
}

export function useSaveMenuItemCosting(branchId: string | null, menuItemId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (dto: SaveCostingInput) => api.put<MenuItemCostingView>(`/costing/menu-items/${menuItemId}?branchId=${branchId}`, dto),
    onSuccess: invalidate,
  });
}

export function useApplyPrice(branchId: string | null, menuItemId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (dto: { price: number; expectedCurrentPrice: number; target: "FULL" | "HALF" }) =>
      api.post<MenuItemCostingView>(`/costing/menu-items/${menuItemId}/apply-price?branchId=${branchId}`, dto),
    onSuccess: invalidate,
  });
}

export function useAcknowledgeCost(branchId: string | null, menuItemId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.post<MenuItemCostingView>(`/costing/menu-items/${menuItemId}/acknowledge?branchId=${branchId}`),
    onSuccess: invalidate,
  });
}

export function useSetOptionIngredients(branchId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ modifierId, lines }: { modifierId: string; lines: { ingredientId: string; quantity: number; unit?: CostUnit | null }[] }) =>
      api.put<{ ok: true }>(`/costing/modifiers/${modifierId}?branchId=${branchId}`, { lines }),
    onSuccess: invalidate,
  });
}

export function usePreparations(branchId: string | null) {
  return useQuery({
    queryKey: key("preparations", branchId),
    queryFn: () => api.get<PreparationView[]>(`/costing/preparations?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function usePreparation(branchId: string | null, id: string | null) {
  return useQuery({
    queryKey: key("preparation", branchId, id),
    queryFn: () => api.get<PreparationView>(`/costing/preparations/${id}?branchId=${branchId}`),
    enabled: !!branchId && !!id,
  });
}

export interface SavePreparationInput {
  name: string;
  unit: CostUnit;
  batchOutputQty: number;
  lines: { ingredientId: string; quantity: number; unit?: CostUnit | null }[];
  overheads: Overhead[];
  baseVersion?: number;
}

export function useSavePreparation(branchId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, dto }: { id?: string; dto: SavePreparationInput }) =>
      id
        ? api.put<PreparationView>(`/costing/preparations/${id}?branchId=${branchId}`, dto)
        : api.post<PreparationView>(`/costing/preparations?branchId=${branchId}`, dto),
    onSuccess: invalidate,
  });
}

export function useDeletePreparation(branchId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/costing/preparations/${id}?branchId=${branchId}`),
    onSuccess: invalidate,
  });
}

export function useProduce(branchId: string | null) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, batches, note, idempotencyKey }: { id: string; batches: number; note?: string; idempotencyKey: string }) =>
      api.post<{ duplicate: boolean; shortages: string[]; run: { outputQty: number; totalCost: number; unitCost: number } }>(
        `/costing/preparations/${id}/produce?branchId=${branchId}`,
        { batches, note, idempotencyKey },
      ),
    onSuccess: invalidate,
  });
}

export type { CostPreparation };
