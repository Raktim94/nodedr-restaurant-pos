"use client";

import type { AdDto, TerminalDto } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Terminal { id: string; name: string; token: string; idleSeconds: number; thankYouSeconds: number; adSlideSeconds: number; adFit: "contain" | "cover"; isActive: boolean; lastSeenAt: string | null; stateAt: string | null }
export interface Ad { id: string; terminalId: string | null; kind: "IMAGE" | "VIDEO"; url: string; title: string | null; durationSec: number | null; sortOrder: number; isActive: boolean; startsOn: string | null; endsOn: string | null }

const q = (b: string | null) => `branchId=${b ?? ""}`;

export const useTerminals = (branchId: string | null) =>
  useQuery({ queryKey: ["display-terminals", branchId], queryFn: () => api.get<Terminal[]>(`/display/terminals?${q(branchId)}`), enabled: !!branchId, refetchInterval: 15_000 });
export const useAds = (branchId: string | null) =>
  useQuery({ queryKey: ["display-ads", branchId], queryFn: () => api.get<Ad[]>(`/display/ads?${q(branchId)}`), enabled: !!branchId });

export function useDisplayActions(branchId: string | null) {
  const qc = useQueryClient();
  const t = () => qc.invalidateQueries({ queryKey: ["display-terminals"] });
  const a = () => qc.invalidateQueries({ queryKey: ["display-ads"] });
  return {
    createTerminal: useMutation({ mutationFn: (d: Partial<TerminalDto> & { name: string }) => api.post(`/display/terminals?${q(branchId)}`, d), onSuccess: t }),
    updateTerminal: useMutation({ mutationFn: (v: { id: string; data: Partial<TerminalDto> }) => api.patch(`/display/terminals/${v.id}?${q(branchId)}`, v.data), onSuccess: t }),
    rotate: useMutation({ mutationFn: (id: string) => api.post(`/display/terminals/${id}/rotate-token?${q(branchId)}`), onSuccess: t }),
    removeTerminal: useMutation({ mutationFn: (id: string) => api.delete(`/display/terminals/${id}?${q(branchId)}`), onSuccess: () => { void t(); void a(); } }),
    upload: useMutation({ mutationFn: (f: File) => api.upload<{ url: string; kind: "IMAGE" | "VIDEO"; bytes: number }>(`/display/media?${q(branchId)}`, f) }),
    createAd: useMutation({ mutationFn: (d: Partial<AdDto> & { kind: "IMAGE" | "VIDEO"; url: string }) => api.post(`/display/ads?${q(branchId)}`, d), onSuccess: a }),
    updateAd: useMutation({ mutationFn: (v: { id: string; data: Partial<AdDto> }) => api.patch(`/display/ads/${v.id}?${q(branchId)}`, v.data), onSuccess: a }),
    removeAd: useMutation({ mutationFn: (id: string) => api.delete(`/display/ads/${id}?${q(branchId)}`), onSuccess: a }),
  };
}
