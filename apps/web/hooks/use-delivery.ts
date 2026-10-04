"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type DeliveryStatus = "UNASSIGNED" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED";

export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  totalAmount: string;
  deliveryFee: string;
  deliveryAddress: string | null;
  deliveryPincode: string | null;
  deliveryPhone: string | null;
  deliveryStatus: DeliveryStatus | null;
  deliveryEtaAt: string | null;
  deliveredAt: string | null;
  scheduledFor: string | null;
  guestName: string | null;
  notes: string | null;
  driver: { id: string; name: string } | null;
  deliveryZone: { id: string; name: string } | null;
}

export interface DeliveryZone {
  id: string;
  name: string;
  fee: string;
  minOrderAmount: string;
  etaMinutes: number;
  pincodes: string[];
  isActive: boolean;
}

export function useDeliveries(branchId: string | null, history: boolean) {
  return useQuery({
    queryKey: ["deliveries", branchId, history],
    queryFn: () => api.get<DeliveryOrder[]>(`/delivery?branchId=${branchId}&history=${history}`),
    enabled: !!branchId,
    refetchInterval: 15_000,
  });
}

export function useDrivers(branchId: string | null) {
  return useQuery({
    queryKey: ["deliveries", "drivers", branchId],
    queryFn: () => api.get<{ id: string; name: string }[]>(`/delivery/drivers?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useDeliveryActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["deliveries"] });
  return {
    assign: useMutation({
      mutationFn: (v: { orderId: string; driverId: string }) =>
        api.patch(`/delivery/${v.orderId}/assign?branchId=${branchId}`, { driverId: v.driverId }),
      onSuccess: done,
    }),
    setStatus: useMutation({
      mutationFn: (v: { orderId: string; status: DeliveryStatus }) =>
        api.patch(`/delivery/${v.orderId}/status?branchId=${branchId}`, { status: v.status }),
      onSuccess: done,
    }),
  };
}

export function useZones(branchId: string | null) {
  return useQuery({
    queryKey: ["delivery-zones", branchId],
    queryFn: () => api.get<DeliveryZone[]>(`/delivery/zones?branchId=${branchId}`),
    enabled: !!branchId,
  });
}

export function useZoneActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["delivery-zones"] });
  return {
    create: useMutation({
      mutationFn: (dto: Omit<DeliveryZone, "id">) => api.post(`/delivery/zones?branchId=${branchId}`, dto),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; dto: Partial<Omit<DeliveryZone, "id">> }) =>
        api.patch(`/delivery/zones/${v.id}?branchId=${branchId}`, v.dto),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/delivery/zones/${id}?branchId=${branchId}`),
      onSuccess: done,
    }),
  };
}
