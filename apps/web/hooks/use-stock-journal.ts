"use client";

import type { IngredientUnit, ProductionEntryDto, WasteEntryDto, WasteReason } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface StockItem {
  id: string;
  name: string;
  unit: IngredientUnit;
  kind: "PURCHASED" | "PREPARED";
  category: string | null;
  currentStock: string;
  units: IngredientUnit[];
}

export interface ProductionLine {
  id: string;
  role: "INPUT" | "OUTPUT";
  ingredientId: string;
  enteredQuantity: string;
  enteredUnit: IngredientUnit;
  quantity: string;
  ingredient: { id: string; name: string; unit: IngredientUnit };
}

export interface ProductionEntry {
  id: string;
  entryNo: string;
  status: "DRAFT" | "POSTED" | "VOIDED";
  producedAt: string;
  shift: string | null;
  location: string | null;
  batchRef: string | null;
  notes: string | null;
  voidReason: string | null;
  responsibleName: string | null;
  lines: ProductionLine[];
  correctsEntry: { id: string; entryNo: string } | null;
  correctedBy: { id: string; entryNo: string; status: string }[];
}

export interface PreviewLine {
  role: "INPUT" | "OUTPUT";
  ingredientId: string;
  name: string;
  entered: string;
  quantity: string;
  unit: IngredientUnit;
  balanceBefore: string;
  balanceAfter: string;
  short: string | null;
}

export interface JournalMovement {
  id: string;
  type: string;
  quantity: string;
  note: string | null;
  createdAt: string;
  productionEntryId: string | null;
  wasteEntryId: string | null;
  deviceId: string | null;
  ingredient: { id: string; name: string; unit: IngredientUnit };
  createdBy: { id: string; name: string };
}

export interface WasteEntry {
  id: string;
  kind: "INGREDIENT" | "FINISHED";
  ingredient: { id: string; name: string; unit: IngredientUnit };
  quantity: string;
  enteredQuantity: string;
  enteredUnit: IngredientUnit;
  reason: WasteReason;
  shift: string | null;
  location: string | null;
  note: string | null;
  occurredAt: string;
  includedInProduction: boolean;
  status: "POSTED" | "PENDING_APPROVAL" | "REJECTED" | "REVERSED";
  createdByName: string | null;
  reverseReason: string | null;
}

export interface WasteReport {
  entryCount: number;
  byItem: { key: string; label: string; unit: string; quantity: string; count: number }[];
  byReason: { key: string; label: string; unit: string; quantity: string; count: number }[];
  trend: { day: string; entries: number }[];
  alreadyInProduction: number;
  pendingApproval: number;
}

export interface ProductionReport {
  entryCount: number;
  produced: { ingredientId: string; name: string; unit: string; quantity: string }[];
  consumed: { ingredientId: string; name: string; unit: string; quantity: string }[];
}

const qs = (branchId: string | null, filters: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({ branchId: branchId ?? "" });
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  return p.toString();
};

export function csvUrl(path: string, branchId: string | null, filters: Record<string, string | undefined> = {}) {
  return `/api/v1/inventory/${path}?${qs(branchId, filters)}`;
}

export const useStockItems = (branchId: string | null) =>
  useQuery({
    queryKey: ["stock-items", branchId],
    queryFn: () => api.get<StockItem[]>(`/inventory/production/items?${qs(branchId)}`),
    enabled: !!branchId,
  });

export const useProductionEntries = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: ["production", branchId, filters],
    queryFn: () => api.get<ProductionEntry[]>(`/inventory/production?${qs(branchId, filters)}`),
    enabled: !!branchId,
  });

export const useProductionReport = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: ["production-report", branchId, filters],
    queryFn: () => api.get<ProductionReport>(`/inventory/production/report?${qs(branchId, filters)}`),
    enabled: !!branchId,
  });

export const useSuggestions = (branchId: string | null, productId: string) =>
  useQuery({
    queryKey: ["production-suggest", branchId, productId],
    queryFn: () =>
      api.get<{ ingredientId: string; name: string; unit: IngredientUnit; lastQuantity: string }[]>(
        `/inventory/production/suggest/${productId}?${qs(branchId)}`,
      ),
    enabled: !!branchId && !!productId,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["production", "production-report", "stock-items", "journal", "ingredients", "waste-entries", "waste-report", "expiring", "reorder"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

type Lines = Pick<ProductionEntryDto, "inputs" | "outputs">;

export const usePreviewProduction = (branchId: string | null) =>
  useMutation({
    mutationFn: (body: Lines) =>
      api.post<{ lines: PreviewLine[]; canPost: boolean }>(`/inventory/production/preview?${qs(branchId)}`, body),
  });

export function useSaveProduction(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Omit<ProductionEntryDto, "post"> & { post: boolean }) =>
      api.post<ProductionEntry>(`/inventory/production?${qs(branchId)}`, body),
    onSuccess: refresh,
  });
}

export function useProductionAction(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (a: { id: string; action: "post" | "void" | "correct"; body?: unknown }) =>
      api.post<ProductionEntry>(`/inventory/production/${a.id}/${a.action}?${qs(branchId)}`, a.body ?? {}),
    onSuccess: refresh,
  });
}

export const useJournal = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: ["journal", branchId, filters],
    queryFn: () => api.get<{ items: JournalMovement[]; nextCursor: string | null }>(`/inventory/journal?${qs(branchId, filters)}`),
    enabled: !!branchId,
  });

export function useReceiveStock(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { ingredientId: string; quantity: string; unit: IngredientUnit; reference?: string; note?: string; expiryDate?: string }) =>
      api.post(`/inventory/journal/receipts?${qs(branchId)}`, body),
    onSuccess: refresh,
  });
}

export function useJournalAdjust(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { ingredientId: string; direction: "ADD" | "REMOVE"; quantity: string; unit: IngredientUnit; reason: string }) =>
      api.post(`/inventory/journal/adjustments?${qs(branchId)}`, body),
    onSuccess: refresh,
  });
}

export const useWasteEntries = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: ["waste-entries", branchId, filters],
    queryFn: () => api.get<WasteEntry[]>(`/inventory/waste/entries?${qs(branchId, filters)}`),
    enabled: !!branchId,
  });

export const useWasteReport = (branchId: string | null, filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: ["waste-report", branchId, filters],
    queryFn: () => api.get<WasteReport>(`/inventory/waste/report?${qs(branchId, filters)}`),
    enabled: !!branchId,
  });

export function useCreateWaste(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Omit<WasteEntryDto, "includedInProduction"> & { includedInProduction?: boolean }) =>
      api.post<WasteEntry>(`/inventory/waste/entries?${qs(branchId)}`, body),
    onSuccess: refresh,
  });
}

export function useWasteAction(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (a: { id: string; action: "approve" | "reject" | "reverse"; body?: unknown }) =>
      api.post<WasteEntry>(`/inventory/waste/entries/${a.id}/${a.action}?${qs(branchId)}`, a.body ?? {}),
    onSuccess: refresh,
  });
}

export interface ExpiringRow { batchId: string; ingredientId: string; name: string; unit: IngredientUnit; storageLocation: string | null; quantity: string; expiryDate: string; expired: boolean; daysLeft: number }
export const useExpiring = (branchId: string | null, days = 7) =>
  useQuery({ queryKey: ["expiring", branchId, days], queryFn: () => api.get<ExpiringRow[]>(`/inventory/journal/expiring?${qs(branchId, { days: String(days) })}`), enabled: !!branchId });

export interface ReorderRow { id: string; name: string; unit: IngredientUnit; category: string | null; storageLocation: string | null; inStock: string; minimum: string; par: string; toBuy: string }
export const useReorder = (branchId: string | null) =>
  useQuery({ queryKey: ["reorder", branchId], queryFn: () => api.get<ReorderRow[]>(`/inventory/journal/reorder?${qs(branchId)}`), enabled: !!branchId });

export interface StockTakeResult { id: string; takenAt: string; area: string | null; lines: { ingredientId: string; name: string; unit: string; expected: string; counted: string; difference: string }[] }
export function useStockTake(branchId: string | null) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { area?: string; note?: string; lines: { ingredientId: string; counted: string; unit: IngredientUnit }[]; idempotencyKey: string }) =>
      api.post<StockTakeResult>(`/inventory/journal/stock-takes?${qs(branchId)}`, body),
    onSuccess: () => { refresh(); },
  });
}
