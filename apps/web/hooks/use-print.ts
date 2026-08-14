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

export function usePrintTestSlip() {
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/orders/print/test"),
  });
}

export function usePrintOrderUsb(branchId: string | null) {
  return useMutation({
    mutationFn: (orderId: string) =>
      api.post<{ ok: true }>(`/orders/${orderId}/print/usb?branchId=${branchId}`),
  });
}
