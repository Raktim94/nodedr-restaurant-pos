"use client";

import type { CustomerDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthday: string | null;
  anniversary: string | null;
  allergies: string | null;
  notes: string | null;
  loyaltyPoints: number;
  walletBalance: string;
  createdAt: string;
}

export interface CustomerDetail extends Customer {
  orders: { id: string; orderNumber: string; totalAmount: string; billedAt: string }[];
  giftCards: { id: string; code: string; balance: string; initialValue: string }[];
}

export function useCustomers(branchId: string | null, search?: string) {
  return useQuery({
    queryKey: ["customers", branchId, search],
    queryFn: () =>
      api.get<Customer[]>(`/customers?branchId=${branchId}${search ? `&search=${search}` : ""}`),
    enabled: !!branchId,
  });
}

export function useCustomer(branchId: string | null, id: string | null) {
  return useQuery({
    queryKey: ["customers", branchId, "detail", id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}?branchId=${branchId}`),
    enabled: !!branchId && !!id,
  });
}

export function useCreateCustomer(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CustomerDto) => api.post<Customer>(`/customers?branchId=${branchId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers", branchId] }),
  });
}
