"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type NfcTagStatus = "PROVISIONING" | "ACTIVE" | "DISABLED";
export interface NfcTag {
  id: string;
  publicRef: string;
  tableId: string;
  tableNumber: string;
  label: string | null;
  mode: "SECURE" | "BASIC";
  status: NfcTagStatus;
  uid: string | null;
  keyVersion: number;
  lastCounter: number;
  lastAuthAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  replacesId: string | null;
  createdAt: string;
}
/** Returned once, when a tag is created or its keys are rotated. */
export interface Provisioning {
  publicRef: string;
  keyVersion: number;
  urlTemplate: string;
  keys: { appMasterKey: string; sdmMetaReadKey: string; sdmFileReadKey: string };
  note: string;
}
export interface TagWithBundle {
  tag: NfcTag;
  provisioning: Provisioning | null;
  basicLink?: { note: string; requiresTableQr: boolean };
}
export interface NfcSettings {
  requireTableSession: boolean;
  nfcTablesEnabled: boolean;
  autoTableSessions: boolean;
  mode: "BASIC" | "ADVANCED";
}

const b = (branchId: string | null) => `branchId=${branchId ?? ""}`;

export const useNfcSettings = () => useQuery({ queryKey: ["nfc-settings"], queryFn: () => api.get<NfcSettings>("/nfc/settings"), retry: false });
export function useUpdateNfcSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { nfcTablesEnabled?: boolean; autoTableSessions?: boolean }) => api.patch<NfcSettings>("/nfc/settings", v),
    onSuccess: (data) => qc.setQueryData(["nfc-settings"], data),
  });
}

export const useNfcTags = (branchId: string | null) =>
  useQuery({ queryKey: ["nfc-tags", branchId], queryFn: () => api.get<NfcTag[]>(`/nfc/tags?${b(branchId)}`), enabled: !!branchId, retry: false });

function useTagMutation<V, R>(branchId: string | null, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ["nfc-tags", branchId] }); void qc.invalidateQueries({ queryKey: ["table-overview"] }); } });
}
export const useCreateNfcTag = (branchId: string | null) =>
  useTagMutation(branchId, (v: { tableId: string; label?: string; mode: "SECURE" | "BASIC" }) => api.post<TagWithBundle>(`/nfc/tags?${b(branchId)}`, v));
export const useTestNfcTag = (branchId: string | null) =>
  useTagMutation(branchId, (v: { id: string; e: string; c: string }) => api.post<NfcTag>(`/nfc/tags/${v.id}/test?${b(branchId)}`, { e: v.e, c: v.c }));
export const useRotateNfcTag = (branchId: string | null) =>
  useTagMutation(branchId, (id: string) => api.post<TagWithBundle>(`/nfc/tags/${id}/rotate?${b(branchId)}`, {}));
export const useDisableNfcTag = (branchId: string | null) =>
  useTagMutation(branchId, (v: { id: string; reason: string }) => api.post<NfcTag>(`/nfc/tags/${v.id}/disable?${b(branchId)}`, { reason: v.reason }));
export const useReplaceNfcTag = (branchId: string | null) =>
  useTagMutation(branchId, (v: { id: string; label?: string }) => api.post<TagWithBundle>(`/nfc/tags/${v.id}/replace?${b(branchId)}`, { label: v.label }));
export const useNfcTaps = (branchId: string | null, id: string | null) =>
  useQuery({ queryKey: ["nfc-taps", id], queryFn: () => api.get<{ id: string; result: string; counter: number | null; createdAt: string }[]>(`/nfc/tags/${id}/taps?${b(branchId)}`), enabled: !!branchId && !!id });

export type TableState = "CLOSED" | "ACCESS_VERIFIED" | "OPEN" | "ORDER_PROCESSING" | "PAYMENT_PENDING" | "SETTLED" | "ATTENTION_REQUIRED";
export interface TableBoardRow {
  id: string;
  number: string;
  name: string | null;
  capacity: number;
  floorId: string;
  floor: string;
  state: TableState;
  reasons: string[];
  orderCount: number;
  billTotal: string;
  guestCount: number;
  sessionOpenedAt: string | null;
  openedVia: string | null;
  lastActivityAt: string | null;
}
export interface TableBoard {
  generatedAt: string;
  counts: Record<TableState, number>;
  activeSessions: number;
  activeOrders: number;
  tables: TableBoardRow[];
}
export const useTableBoard = (branchId: string | null) =>
  useQuery({ queryKey: ["table-overview", branchId], queryFn: () => api.get<TableBoard>(`/tables/overview?${b(branchId)}`), enabled: !!branchId, refetchInterval: 8_000 });
