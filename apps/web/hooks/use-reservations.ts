"use client";

import type {
  CreateReservationDto,
  ReservationStatusDto,
} from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Reservation {
  id: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  guestCount: number;
  reservedAt: string;
  durationMinutes: number;
  tableId: string | null;
  table: { id: string; number: string; name: string | null } | null;
  specialRequests: string | null;
  deposit: string | null;
  status: ReservationStatusDto;
}

export function useReservations(branchId: string | null, date?: string) {
  return useQuery({
    queryKey: ["reservations", branchId, date],
    queryFn: () =>
      api.get<Reservation[]>(
        `/reservations?branchId=${branchId}${date ? `&date=${date}` : ""}`,
      ),
    enabled: !!branchId,
    refetchInterval: 30_000,
  });
}

export function useCreateReservation(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateReservationDto) =>
      api.post(`/reservations?branchId=${branchId}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservations", branchId] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
    },
  });
}

export function useUpdateReservationStatus(branchId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ReservationStatusDto }) =>
      api.patch(`/reservations/${id}/status?branchId=${branchId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reservations", branchId] });
      queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
    },
  });
}
