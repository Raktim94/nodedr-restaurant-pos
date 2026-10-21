"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type VerifactuEnvironment = "TEST" | "PRODUCTION";

export interface VerifactuSettings {
  enabled: boolean;
  environment: VerifactuEnvironment;
  seriesPrefix: string;
  nextNumber: number;
  hasCertificate: boolean;
  certSubject: string | null;
  certExpiresAt: string | null;
  problems: string[];
  counts: Record<string, number>;
  status: "implemented-not-certified";
}

export interface VerifactuRecordRow {
  id: string;
  seq: number;
  type: "ALTA" | "ANULACION";
  invoiceType: string;
  invoiceNumber: string;
  issueDate: string;
  totalCents: number;
  taxTotalCents: number;
  hash: string;
  status: "PENDING" | "ACCEPTED" | "ACCEPTED_WITH_ERRORS" | "REJECTED" | "ERROR";
  attempts: number;
  csv: string | null;
  errorCode: string | null;
  errorText: string | null;
  submittedAt: string | null;
  environment: VerifactuEnvironment;
}

export type VerifactuVerify =
  | { ok: true; checked: number }
  | { ok: false; checked: number; brokenAt: number; environment: VerifactuEnvironment; reason: string };

const q = (branchId: string) => `branchId=${encodeURIComponent(branchId)}`;

export function useVerifactuSettings(branchId: string | null) {
  return useQuery({
    queryKey: ["verifactu", "settings", branchId],
    queryFn: () => api.get<VerifactuSettings>(`/verifactu/settings?${q(branchId!)}`),
    enabled: !!branchId,
  });
}

export function useVerifactuRecords(branchId: string | null) {
  return useQuery({
    queryKey: ["verifactu", "records", branchId],
    queryFn: () => api.get<{ items: VerifactuRecordRow[]; total: number }>(`/verifactu/records?${q(branchId!)}&take=50`),
    enabled: !!branchId,
    refetchInterval: 30_000,
  });
}

export function useVerifactuActions(branchId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["verifactu"] });
  return {
    save: useMutation({
      mutationFn: (dto: { enabled: boolean; environment: VerifactuEnvironment; seriesPrefix: string }) =>
        api.put<VerifactuSettings>(`/verifactu/settings?${q(branchId)}`, dto),
      onSuccess: refresh,
    }),
    certificate: useMutation({
      mutationFn: (v: { file: File; password: string }) => {
        const form = new FormData();
        form.append("file", v.file);
        form.append("password", v.password);
        return api.postForm<VerifactuSettings>(`/verifactu/certificate?${q(branchId)}`, form);
      },
      onSuccess: refresh,
    }),
    send: useMutation({
      mutationFn: () => api.post<{ sent: number }>(`/verifactu/send?${q(branchId)}`),
      onSuccess: refresh,
    }),
    verify: useMutation({ mutationFn: () => api.get<VerifactuVerify>(`/verifactu/verify?${q(branchId)}`) }),
  };
}
