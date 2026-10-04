"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface AttendanceRecord {
  id: string;
  branchId: string;
  userId: string;
  user: { id: string; name: string };
  clockInAt: string;
  clockOutAt: string | null;
  note: string | null;
}

export function useMyShift() {
  return useQuery({
    queryKey: ["attendance", "me"],
    queryFn: () => api.get<AttendanceRecord | null>("/attendance/me"),
  });
}

export function useAttendance(branchId: string | null, date: string, enabled: boolean) {
  return useQuery({
    queryKey: ["attendance", branchId, date],
    queryFn: () => api.get<AttendanceRecord[]>(`/attendance?branchId=${branchId}&date=${date}`),
    enabled: !!branchId && enabled,
    refetchInterval: 30_000,
  });
}

export function useClock(branchId: string | null) {
  const queryClient = useQueryClient();
  const done = () => queryClient.invalidateQueries({ queryKey: ["attendance"] });
  const clockIn = useMutation({
    mutationFn: () => api.post<AttendanceRecord>("/attendance/clock-in", { branchId }),
    onSuccess: done,
  });
  const clockOut = useMutation({
    mutationFn: () => api.post<AttendanceRecord>("/attendance/clock-out", {}),
    onSuccess: done,
  });
  return { clockIn, clockOut };
}
