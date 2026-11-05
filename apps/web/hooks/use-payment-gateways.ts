"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type GatewayMode = "TEST" | "LIVE";

export interface GatewayField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
}

export interface GatewayConnection {
  provider: string;
  country: string;
  enabled: boolean;
  mode: GatewayMode;
  liveConfirmedAt: string | null;
  /** Names of fields that are set. Values never leave the server. */
  testKeys: string[];
  liveKeys: string[];
  testComplete: boolean;
  liveComplete: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  webhookPaths: Record<GatewayMode, string>;
}

export interface GatewayProvider {
  key: string;
  name: string;
  integration: string;
  docsUrl: string;
  notes: string | null;
  sources: string[];
  custom: boolean;
  integrated: boolean;
  fields: GatewayField[];
  requiresCustomerPhone: boolean;
  limitations: string[];
  connection: GatewayConnection | null;
}

export interface GatewayCatalog {
  country: string;
  researchedAt: string;
  note: string;
  providers: GatewayProvider[];
}

export interface GatewayPaymentRow {
  id: string;
  orderId: string;
  provider: string;
  mode: GatewayMode;
  status: "CREATED" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "NEEDS_REVIEW";
  amountMinor: number;
  currency: string;
  checkoutUrl: string | null;
  note: string | null;
  createdAt: string;
}

const KEY = ["payment-gateways"];

export function useGatewayCountries() {
  return useQuery({
    queryKey: [...KEY, "countries"],
    queryFn: () => api.get<{ code: string; name: string }[]>("/payment-gateways/countries"),
  });
}

export function useGatewayCatalog(country: string) {
  return useQuery({
    queryKey: [...KEY, "catalog", country],
    queryFn: () => api.get<GatewayCatalog>(`/payment-gateways/catalog?country=${country}`),
    enabled: /^[A-Z]{2}$/.test(country),
  });
}

export function useGatewayConnections() {
  return useQuery({
    queryKey: [...KEY, "connections"],
    queryFn: () => api.get<GatewayConnection[]>("/payment-gateways/connections"),
  });
}

export function useRecentGatewayPayments() {
  return useQuery({
    queryKey: [...KEY, "payments"],
    queryFn: () => api.get<GatewayPaymentRow[]>("/payment-gateways/payments"),
  });
}

export function useGatewayActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: KEY });
  const o = { onSuccess: done };
  return {
    save: useMutation({
      mutationFn: (v: { provider: string; country: string; mode: GatewayMode; credentials: Record<string, string> }) =>
        api.put(`/payment-gateways/${v.provider}`, { country: v.country, mode: v.mode, credentials: v.credentials }),
      ...o,
    }),
    test: useMutation({
      mutationFn: (v: { provider: string; mode?: GatewayMode }) =>
        api.post<{ ok: boolean; mode: GatewayMode; message: string }>(`/payment-gateways/${v.provider}/test`, { mode: v.mode }),
      onSuccess: done,
      onError: done,
    }),
    setMode: useMutation({
      mutationFn: (v: { provider: string; mode: GatewayMode; confirm?: string }) =>
        api.post(`/payment-gateways/${v.provider}/mode`, { mode: v.mode, confirm: v.confirm }),
      ...o,
    }),
    setEnabled: useMutation({
      mutationFn: (v: { provider: string; enabled: boolean }) =>
        api.post(`/payment-gateways/${v.provider}/enabled`, { enabled: v.enabled }),
      ...o,
    }),
    removeCredentials: useMutation({
      mutationFn: (v: { provider: string; mode: GatewayMode }) =>
        api.delete(`/payment-gateways/${v.provider}/credentials/${v.mode}`),
      ...o,
    }),
    removeConnection: useMutation({
      mutationFn: (provider: string) => api.delete(`/payment-gateways/${provider}`),
      ...o,
    }),
    saveCustom: useMutation({
      mutationFn: (v: { key: string; name: string; countries: string[]; docsUrl: string; adapter: string | null; notes?: string }) =>
        api.put(`/payment-gateways/custom/${v.key}`, v),
      ...o,
    }),
    removeCustom: useMutation({
      mutationFn: (key: string) => api.delete(`/payment-gateways/custom/${key}`),
      ...o,
    }),
  };
}

/** Collecting a bill online from the POS. */
export function useCreateGatewayPayment(branchId: string) {
  return useMutation({
    mutationFn: (v: { orderId: string; customerPhone?: string; customerName?: string }) =>
      api.post<GatewayPaymentRow>(`/orders/${v.orderId}/gateway-payments?branchId=${branchId}`, {
        customerPhone: v.customerPhone || undefined,
        customerName: v.customerName || undefined,
        origin: typeof window === "undefined" ? undefined : window.location.origin,
      }),
  });
}

export function useRefreshGatewayPayment(branchId: string) {
  return useMutation({
    mutationFn: (id: string) => api.post<GatewayPaymentRow>(`/gateway-payments/${id}/refresh?branchId=${branchId}`),
  });
}

export interface ActiveGateway {
  provider: string;
  name: string;
  mode: GatewayMode;
  requiresCustomerPhone: boolean;
}

/** The gateway the POS may offer, or null when none is switched on. */
export function useActiveGateway() {
  return useQuery({
    queryKey: [...KEY, "active"],
    queryFn: () => api.get<ActiveGateway | null>("/payment-gateways/active"),
    staleTime: 60_000,
  });
}

export type OrderGatewayPayment = GatewayPaymentRow & { refundableMinor: number };

/** Online payments taken for an order, with how much of each can still be sent back. */
export function useOrderGatewayPayments(branchId: string | null, orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, "order", branchId, orderId],
    queryFn: () => api.get<OrderGatewayPayment[]>(`/orders/${orderId}/gateway-payments?branchId=${branchId}`),
    enabled: enabled && !!branchId,
  });
}

export function useGatewayRefund(branchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      paymentId: string;
      amount: number;
      reason?: string;
      returnedItems?: { orderItemId: string; quantity: number }[];
    }) =>
      api.post<{ ok: boolean; providerRefundId: string }>(`/gateway-payments/${v.paymentId}/refund?branchId=${branchId}`, {
        amount: v.amount,
        reason: v.reason,
        returnedItems: v.returnedItems,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface RefundToReview {
  id: string;
  orderId: string;
  provider: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  providerRefundId: string | null;
  createdAt: string;
}

export function useRefundsToReview() {
  return useQuery({
    queryKey: [...KEY, "refunds-to-review"],
    queryFn: () => api.get<RefundToReview[]>("/payment-gateways/refunds-to-review"),
  });
}
