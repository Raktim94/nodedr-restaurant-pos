"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface PrinterDiagnostics {
  lpDevices: string[];
  libusbPrinter: { vendorId: number; productId: number; id: string } | null;
  canPrint: boolean;
  notes: string[];
}

export function usePrinterDiagnostics() {
  return useQuery({
    queryKey: ["print", "diagnostics"],
    queryFn: () => api.get<PrinterDiagnostics>("/orders/print/diagnostics"),
    refetchOnWindowFocus: false,
  });
}

export interface PrintJobResult {
  ok: true;
  /** Characters the printer's code page cannot print (shown as "?" on paper). */
  unsupportedChars?: string[];
}

export function usePrintTestSlip(branchId?: string | null) {
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>(`/orders/print/test${branchId ? `?branchId=${branchId}` : ""}`),
  });
}

/** `drawer` also kicks the cash drawer — pass true when the bill was paid in cash. */
export function usePrintOrderUsb(branchId: string | null) {
  return useMutation({
    mutationFn: ({ orderId, drawer }: { orderId: string; drawer?: boolean }) =>
      api.post<PrintJobResult>(`/orders/${orderId}/print/usb?branchId=${branchId}${drawer ? "&drawer=true" : ""}`),
  });
}

/** Kitchen ticket straight to the thermal printer (native text, no prices). */
export function usePrintKotUsb(branchId: string | null) {
  return useMutation({
    mutationFn: (orderId: string) => api.post<PrintJobResult>(`/orders/${orderId}/print/kot/usb?branchId=${branchId}`),
  });
}

export function useOpenCashDrawer() {
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/orders/print/drawer"),
  });
}
