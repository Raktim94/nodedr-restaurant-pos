"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { billQueryString, type BillQuery } from "@/lib/print";
import { canPrintOnDevice, printEscposOnDevice } from "@/lib/device-print";

export interface PrinterDiagnostics {
  connection: "USB" | "NETWORK";
  network: { host: string; port: number; reachable: boolean; error: string | null } | null;
  lpDevices: string[];
  libusbPrinter: { vendorId: number; productId: number; id: string } | null;
  canPrint: boolean;
  notes: string[];
}

export function usePrinterDiagnostics(branchId?: string | null) {
  return useQuery({
    queryKey: ["print", "diagnostics", branchId ?? null],
    queryFn: () => api.get<PrinterDiagnostics>(`/orders/print/diagnostics${branchId ? `?branchId=${branchId}` : ""}`),
    refetchOnWindowFocus: false,
  });
}

export interface PrintJobResult {
  ok: true;
  /** Characters the printer's code page cannot print (shown as "?" on paper). */
  unsupportedChars?: string[];
}

/** kind "kot" prints a sample kitchen ticket instead of the receipt test slip. */
export function usePrintTestSlip(branchId?: string | null, kind?: "kot") {
  return useMutation({
    mutationFn: async () => {
      const onDevice = canPrintOnDevice();
      const q = [branchId ? `branchId=${branchId}` : "", kind ? `kind=${kind}` : "", onDevice ? "via=device" : ""]
        .filter(Boolean)
        .join("&");
      const r = await api.post<{ ok: true; escpos?: string[] }>(`/orders/print/test?${q}`);
      if (onDevice && r.escpos) await printEscposOnDevice(r.escpos);
      return { ok: true as const };
    },
  });
}

/**
 * `drawer` also kicks the cash drawer — pass true when the bill was paid in
 * cash. `adjustments` prices a not-yet-paid bill the way the screen shows it;
 * a bill printed before payment never opens the drawer.
 */
export function usePrintOrderUsb(branchId: string | null) {
  return useMutation({
    mutationFn: async ({ orderId, drawer, adjustments }: { orderId: string; drawer?: boolean; adjustments?: BillQuery }) => {
      // In the phone app the bill goes to the phone's own Bluetooth printer;
      // everywhere else to the printer attached to the restaurant computer.
      const onDevice = canPrintOnDevice();
      const r = await api.post<PrintJobResult & { escpos?: string[] }>(
        `/orders/${orderId}/print/usb?branchId=${branchId}${drawer ? "&drawer=true" : ""}${onDevice ? "&via=device" : ""}${billQueryString(adjustments)}`,
      );
      if (onDevice && r.escpos) await printEscposOnDevice(r.escpos);
      return { ok: true as const, unsupportedChars: r.unsupportedChars };
    },
  });
}

export interface KotPrintResult extends PrintJobResult {
  printed: { id: string; ticketNumber: string; reprint: number }[];
}

/**
 * Kitchen tickets to the thermal printer (native text, no prices). Without
 * `reprint` only tickets not yet printed go out and a repeat answers
 * ALREADY_PRINTED; `reprint: true` prints another copy stamped REPRINT.
 */
export function usePrintKot(branchId: string | null) {
  return useMutation({
    mutationFn: async ({ orderId, reprint }: { orderId: string; reprint?: boolean }) => {
      const onDevice = canPrintOnDevice();
      const r = await api.post<KotPrintResult & { escpos?: string[] }>(
        `/orders/${orderId}/print/kot?branchId=${branchId}${reprint ? "&reprint=true" : ""}${onDevice ? "&via=device" : ""}`,
      );
      if (onDevice && r.escpos) await printEscposOnDevice(r.escpos);
      return r as KotPrintResult;
    },
  });
}

export function useOpenCashDrawer() {
  return useMutation({
    mutationFn: async (branchId?: string | null) => {
      const onDevice = canPrintOnDevice();
      const q = [branchId ? `branchId=${branchId}` : "", onDevice ? "via=device" : ""].filter(Boolean).join("&");
      const r = await api.post<{ ok: true; escpos?: string[] }>(`/orders/print/drawer${q ? `?${q}` : ""}`);
      if (onDevice && r.escpos) await printEscposOnDevice(r.escpos);
      return { ok: true as const };
    },
  });
}
