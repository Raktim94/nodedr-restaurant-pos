"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isNetworkError, outbox } from "@/lib/outbox";

export type RiderStatus = "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED";

export interface RiderCard {
  id: string;
  orderNumber: string;
  status: RiderStatus;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failedReason: string | null;
  pickup: { name: string; address: string | null; phone: string | null };
  customer: { name: string | null; phone: string | null };
  address: string | null;
  pincode: string | null;
  location: { lat: number | null; lng: number | null; place: string | null; mapsUrl: string };
  notes: string | null;
  items: { name: string; quantity: number }[];
  amountToCollect: number;
  orderTotal: number;
  foodReady: boolean;
}

export interface RiderMe {
  name: string;
  phone: string | null;
  online: boolean;
  location: { id: string; name: string; address: string | null };
  today: { active: number; delivered: number; failed: number };
}

const KEY = ["rider"];

export function useRiderMe() {
  return useQuery({ queryKey: [...KEY, "me"], queryFn: () => api.get<RiderMe>("/rider/me"), retry: false, refetchInterval: 30_000 });
}

export function useRiderDeliveries(enabled = true) {
  return useQuery({
    queryKey: [...KEY, "deliveries"],
    queryFn: () => api.get<{ active: RiderCard[]; done: RiderCard[] }>("/rider/deliveries"),
    // New assignments reach the phone within a few seconds.
    refetchInterval: 6_000,
    refetchIntervalInBackground: true,
    enabled,
  });
}

export function useRiderActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    duty: useMutation({
      mutationFn: (online: boolean) => api.post<{ online: boolean }>("/rider/duty", { online }),
      onSuccess: refresh,
    }),
    status: useMutation({
      mutationFn: async (v: { id: string; status: "PICKED_UP" | "DELIVERED" | "FAILED"; reason?: string }) => {
        const path = `/rider/deliveries/${v.id}/status`;
        const body = { status: v.status, reason: v.reason };
        try {
          return await api.patch<RiderCard>(path, body);
        } catch (e) {
          // No connection: keep the update on the phone and send it when the server is back.
          if (!isNetworkError(e)) throw e;
          outbox.add({ method: "PATCH", path, body, label: `Delivery ${v.status.toLowerCase().replace("_", " ")}` });
          return null;
        }
      },
      onSuccess: refresh,
    }),
  };
}

export function sendRiderLocation(lat: number, lng: number) {
  return api.post<{ saved: boolean }>("/rider/location", { lat, lng }).catch(() => undefined);
}

/** A short two-tone alert for a new delivery, plus a vibration on phones that support it. */
export function playNewDeliveryAlert() {
  try {
    navigator.vibrate?.([250, 120, 250, 120, 400]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t);
      o.stop(t + 0.22);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Sound is a nicety; the card still appears.
  }
}
