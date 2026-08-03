"use client";

import type { CheckoutDto, CreateOrderDto } from "@nodedr-restaurant/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
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
