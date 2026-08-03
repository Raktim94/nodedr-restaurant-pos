"use client";

import type {
  GoodsReceiptDto,
  IngredientDto,
  IngredientUnit,
  PurchaseOrderDto,
  PurchaseOrderStatus,
  StockAdjustmentDto,
  SupplierDto,
  WasteLogDto,
  WasteReason,
} from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Ingredient {
  id: string;
  name: string;
  sku: string | null;
  unit: IngredientUnit;
  reorderLevel: string;
  currentStock: string;
  costPerUnit: string;
  isActive: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstNumber: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface PurchaseOrderItem {
  id: string;
  ingredientId: string;
  ingredient?: Ingredient;
  quantityOrdered: string;
  unitCost: string;
  quantityReceived: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplier: { id: string; name: string };
  expectedDate: string | null;
  notes: string | null;
  totalAmount: string;
  createdBy: { id: string; name: string };
  createdAt: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  goodsReceipts: {
    id: string;
    grnNumber: string;
    receivedAt: string;
    receivedBy: { id: string; name: string };
    items: unknown[];
  }[];
}

export interface StockBatch {
  id: string;
  batchNumber: string;
  quantityReceived: string;
  quantityRemaining: string;
  unitCost: string;
  expiryDate: string | null;
  receivedAt: string;
}

export interface StockMovement {
  id: string;
  type: "RECEIPT" | "WASTE" | "ADJUSTMENT" | "CONSUMPTION";
  quantity: string;
  note: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface WasteLog {
  id: string;
  ingredientId: string;
  ingredient: { id: string; name: string; unit: IngredientUnit };
  quantity: string;
  reason: WasteReason;
  unitCostAtWaste: string;
  notes: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface RecipeLine {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: IngredientUnit;
  quantity: number;
  costPerUnit: number;
  lineCost: number;
}

export interface Recipe {
  lines: RecipeLine[];
  totalCost: number;
}

// --- Ingredients -----------------------------------------------------------

export function useIngredients(branchId: string | null) {
  return useQuery({
    queryKey: ["inventory", "ingredients", branchId],
    queryFn: () => api.get<Ingredient[]>(`/inventory/ingredients?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useLowStockIngredients(branchId: string | null) {
  return useQuery({
    queryKey: ["inventory", "ingredients", branchId, "low-stock"],
    queryFn: () =>
      api.get<Ingredient[]>(`/inventory/ingredients/low-stock?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useCreateIngredient(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: IngredientDto) =>
      api.post<Ingredient>(`/inventory/ingredients?branchId=${branchId}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "ingredients", branchId] }),
  });
}

export function useUpdateIngredient(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<IngredientDto> }) =>
      api.patch<Ingredient>(`/inventory/ingredients/${id}?branchId=${branchId}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "ingredients", branchId] }),
  });
}

export function useAdjustStock(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: StockAdjustmentDto }) =>
      api.post(`/inventory/ingredients/${id}/adjust?branchId=${branchId}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "ingredients", branchId] }),
  });
}

export function useIngredientMovements(branchId: string | null, ingredientId: string | null) {
  return useQuery({
    queryKey: ["inventory", "movements", branchId, ingredientId],
    queryFn: () =>
      api.get<StockMovement[]>(
        `/inventory/ingredients/${ingredientId}/movements?branchId=${branchId}`,
      ),
    enabled: !!branchId && !!ingredientId,
  });
}

export function useIngredientBatches(branchId: string | null, ingredientId: string | null) {
  return useQuery({
    queryKey: ["inventory", "batches", branchId, ingredientId],
    queryFn: () =>
      api.get<StockBatch[]>(`/inventory/ingredients/${ingredientId}/batches?branchId=${branchId}`),
    enabled: !!branchId && !!ingredientId,
  });
}

// --- Recipe costing ----------------------------------------------------------

export function useRecipe(branchId: string | null, menuItemId: string | null) {
  return useQuery({
    queryKey: ["inventory", "recipe", branchId, menuItemId],
    queryFn: () => api.get<Recipe>(`/inventory/menu-items/${menuItemId}/recipe?branchId=${branchId}`),
    enabled: !!branchId && !!menuItemId,
  });
}

export function useSetRecipe(branchId: string | null, menuItemId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: { ingredientId: string; quantity: number }[]) =>
      api.patch<Recipe>(`/inventory/menu-items/${menuItemId}/recipe?branchId=${branchId}`, {
        lines,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", "recipe", branchId, menuItemId] });
      qc.invalidateQueries({ queryKey: ["menu"] });
    },
  });
}

// --- Suppliers ---------------------------------------------------------------

export function useSuppliers(branchId: string | null) {
  return useQuery({
    queryKey: ["inventory", "suppliers", branchId],
    queryFn: () => api.get<Supplier[]>(`/inventory/suppliers?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useCreateSupplier(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: SupplierDto) => api.post<Supplier>(`/inventory/suppliers?branchId=${branchId}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "suppliers", branchId] }),
  });
}

// --- Purchase orders -----------------------------------------------------------

export function usePurchaseOrders(branchId: string | null, status?: PurchaseOrderStatus) {
  return useQuery({
    queryKey: ["inventory", "purchase-orders", branchId, status],
    queryFn: () =>
      api.get<PurchaseOrder[]>(
        `/inventory/purchase-orders?branchId=${branchId}${status ? `&status=${status}` : ""}`,
      ),
    enabled: !!branchId,
  });
}

export function usePurchaseOrder(branchId: string | null, id: string | null) {
  return useQuery({
    queryKey: ["inventory", "purchase-orders", branchId, "detail", id],
    queryFn: () =>
      api.get<PurchaseOrderDetail>(`/inventory/purchase-orders/${id}?branchId=${branchId}`),
    enabled: !!branchId && !!id,
  });
}

export function useCreatePurchaseOrder(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: PurchaseOrderDto) =>
      api.post<PurchaseOrder>(`/inventory/purchase-orders?branchId=${branchId}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "purchase-orders", branchId] }),
  });
}

export function useUpdatePurchaseOrderStatus(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: PurchaseOrderStatus }) =>
      api.patch<PurchaseOrder>(`/inventory/purchase-orders/${id}/status?branchId=${branchId}`, {
        status,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", "purchase-orders", branchId] }),
  });
}

// --- Goods receipts (GRN) -----------------------------------------------------

export function useCreateGoodsReceipt(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: GoodsReceiptDto) =>
      api.post(`/inventory/goods-receipts?branchId=${branchId}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", "purchase-orders", branchId] });
      qc.invalidateQueries({ queryKey: ["inventory", "ingredients", branchId] });
      qc.invalidateQueries({ queryKey: ["inventory", "goods-receipts", branchId] });
    },
  });
}

export function useGoodsReceipts(branchId: string | null) {
  return useQuery({
    queryKey: ["inventory", "goods-receipts", branchId],
    queryFn: () => api.get(`/inventory/goods-receipts?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

// --- Waste -----------------------------------------------------------------------

export function useWasteLogs(branchId: string | null) {
  return useQuery({
    queryKey: ["inventory", "waste", branchId],
    queryFn: () => api.get<WasteLog[]>(`/inventory/waste?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useLogWaste(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: WasteLogDto) => api.post(`/inventory/waste?branchId=${branchId}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory", "waste", branchId] });
      qc.invalidateQueries({ queryKey: ["inventory", "ingredients", branchId] });
    },
  });
}
