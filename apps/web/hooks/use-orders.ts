"use client";

import type { AddOrderItemsDto, CheckoutDto, CreateOrderDto, RefundDto, UpdateOrderDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer } from "@/hooks/use-customers";
import { api } from "@/lib/api";

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  tipAmount: string;
  loyaltyPointsRedeemed: number;
  loyaltyDiscountAmount: string;
  totalAmount: string;
  deliveryFee?: string;
  status: string;
  payments?: { method: string; amount: string }[];
}

export function useCreateOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateOrderDto) => api.post<CreatedOrder>(`/orders?branchId=${branchId}`, dto),
    onSuccess: () => {
      // Without refreshing the per-table open-bill cache, going Table 1 -> 2 ->
      // 1 showed Table 1 as having no order and the next send opened a duplicate.
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "summary", branchId] });
    },
  });
}

export function useCheckoutOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, dto }: { orderId: string; dto: CheckoutDto }) =>
      api.post<CreatedOrder>(`/orders/${orderId}/checkout?branchId=${branchId}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "summary", branchId] });
    },
  });
}

export interface OpenOrder {
  id: string;
  orderNumber: string;
  type: string;
  tableId: string | null;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  tipAmount: string;
  loyaltyPointsRedeemed: number;
  loyaltyDiscountAmount: string;
  totalAmount: string;
  status: string;
  customer: Customer | null;
}

export type OrderChannel = "STAFF" | "ONLINE";
export type AcceptanceStatus = "NOT_REQUIRED" | "PENDING" | "ACCEPTED" | "REJECTED";

// Shape of GET /orders/:id (the order row with its relations).
export interface OrderDetail {
  id: string;
  orderNumber: string;
  type: string;
  status: string;
  channel: OrderChannel;
  acceptance: AcceptanceStatus;
  tableId: string | null;
  guestName: string | null;
  guestCount: number | null;
  notes: string | null;
  cancelReason: string | null;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  tipAmount: string;
  totalAmount: string;
  createdAt: string;
  billedAt: string | null;
  table: { id: string; name: string | null; number: string } | null;
  customer: Customer | null;
  items: {
    id: string;
    menuItemId: string;
    nameSnapshot: string;
    quantity: number;
    unitPriceSnapshot: string;
    lineTotal: string;
    kitchenNote: string | null;
    modifiers: { id: string; nameSnapshot: string; priceAdjSnapshot: string }[];
  }[];
  kots: {
    id: string;
    status: string;
    printedCount: number;
    items: { orderItemId: string; status: string }[];
  }[];
  payments: { id: string; method: string; amount: string }[];
}

export function useOrder(branchId: string | null, orderId: string | null) {
  return useQuery({
    queryKey: ["orders", "detail", branchId, orderId],
    queryFn: () => api.get<OrderDetail>(`/orders/${orderId}?branchId=${branchId}`),
    enabled: !!branchId && !!orderId,
  });
}

export interface ManagedOrder {
  id: string;
  orderNumber: string;
  type: string;
  status: string;
  channel: OrderChannel;
  acceptance: AcceptanceStatus;
  guestName: string | null;
  totalAmount: string;
  createdAt: string;
  table: { id: string; name: string | null; number: number } | null;
  customer: Customer | null;
  items: { id: string; nameSnapshot: string; quantity: number }[];
}

export type OrderTab = "pending" | "active" | "history";

export function useManagedOrders(
  branchId: string | null,
  tab: OrderTab,
  channel?: OrderChannel,
  type?: string,
) {
  return useQuery({
    queryKey: ["orders", "manage", branchId, tab, channel ?? "", type ?? ""],
    queryFn: () => {
      const q = new URLSearchParams({ branchId: branchId ?? "", tab });
      if (channel) q.set("channel", channel);
      if (type) q.set("type", type);
      return api.get<ManagedOrder[]>(`/orders/manage?${q.toString()}`);
    },
    enabled: !!branchId,
    refetchInterval: 10_000,
  });
}

export function useAcceptOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/accept?branchId=${branchId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["kds", "tickets", branchId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRejectOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/reject?branchId=${branchId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useOpenOrders(branchId: string | null) {
  return useQuery({
    queryKey: ["orders", "open", branchId],
    queryFn: () => api.get<OpenOrder[]>(`/orders?branchId=${branchId}`),
    enabled: !!branchId,
    refetchInterval: 15_000,
  });
}

export function useOpenOrdersForTable(branchId: string | null, tableId: string | null) {
  return useQuery({
    queryKey: ["orders", "open", branchId, "table", tableId],
    queryFn: () => api.get<OpenOrder[]>(`/orders?branchId=${branchId}&tableId=${tableId}`),
    enabled: !!branchId && !!tableId,
    // A table's bills change from other terminals; never trust a cached list.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useAddOrderItems(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, dto }: { orderId: string; dto: AddOrderItemsDto }) =>
      api.post<CreatedOrder>(`/orders/${orderId}/items?branchId=${branchId}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
    },
  });
}

export function useMergeOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetOrderId, sourceOrderId }: { targetOrderId: string; sourceOrderId: string }) =>
      api.post(`/orders/${targetOrderId}/merge?branchId=${branchId}`, { sourceOrderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
      queryClient.invalidateQueries({ queryKey: ["orders", "open", branchId] });
    },
  });
}

// Everything a changed bill can touch on screen: lists, the table map, the
// kitchen screen, dashboard figures.
function invalidateBillViews(queryClient: ReturnType<typeof useQueryClient>, branchId: string | null) {
  queryClient.invalidateQueries({ queryKey: ["orders"] });
  queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
  queryClient.invalidateQueries({ queryKey: ["kds", "tickets", branchId] });
  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useCancelOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      api.post<CreatedOrder>(`/orders/${orderId}/cancel?branchId=${branchId}`, { reason }),
    onSuccess: () => invalidateBillViews(queryClient, branchId),
  });
}

export function useUpdateOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, dto }: { orderId: string; dto: UpdateOrderDto }) =>
      api.patch<OrderDetail>(`/orders/${orderId}?branchId=${branchId}`, dto),
    onSuccess: () => invalidateBillViews(queryClient, branchId),
  });
}

export function useUpdateOrderItem(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId, quantity }: { orderId: string; itemId: string; quantity: number }) =>
      api.patch<OrderDetail>(`/orders/${orderId}/items/${itemId}?branchId=${branchId}`, { quantity }),
    onSuccess: () => invalidateBillViews(queryClient, branchId),
  });
}

export function useRemoveOrderItem(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId, reason }: { orderId: string; itemId: string; reason: string }) =>
      api.post<OrderDetail>(`/orders/${orderId}/items/${itemId}/remove?branchId=${branchId}`, { reason }),
    onSuccess: () => invalidateBillViews(queryClient, branchId),
  });
}

export function useRefundOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, dto }: { orderId: string; dto: RefundDto }) =>
      api.post(`/orders/${orderId}/refund?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", "summary", branchId] }),
  });
}

export function useDeleteOrders(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { orderIds: string[]; password: string }) =>
      api.post<{ deleted: number }>(`/orders/delete-bulk?branchId=${branchId}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
