"use client";

import type { AddOrderItemsDto, CheckoutDto, CreateOrderDto, RefundDto } from "@nodedr-restaurant/types";
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
  status: string;
}

export function useCreateOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateOrderDto) => api.post<CreatedOrder>(`/orders?branchId=${branchId}`, dto),
    onSuccess: () => {
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
  });
}

export function useAddOrderItems(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, dto }: { orderId: string; dto: AddOrderItemsDto }) =>
      api.post<CreatedOrder>(`/orders/${orderId}/items?branchId=${branchId}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "open", branchId] });
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

export function useCancelOrder(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<CreatedOrder>(`/orders/${orderId}/cancel?branchId=${branchId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "open", branchId] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
      queryClient.invalidateQueries({ queryKey: ["kds", "tickets", branchId] });
    },
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
