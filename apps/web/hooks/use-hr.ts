"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Shift {
  id: string;
  userId: string;
  user: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  note: string | null;
}
export interface LeaveRow {
  id: string;
  type: "ANNUAL" | "SICK" | "UNPAID" | "OTHER";
  status: "PENDING" | "APPROVED" | "REJECTED";
  startDate: string;
  endDate: string;
  reason: string | null;
  user?: { id: string; name: string };
}
export interface PayRow {
  userId: string;
  name: string;
  payType: "MONTHLY" | "HOURLY" | null;
  rate: number | null;
}
export interface PayrollRunRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "DRAFT" | "FINALIZED";
  tipPool: string;
  totalNet: string;
}
export interface PayrollRunDetail extends PayrollRunRow {
  lines: {
    id: string;
    user: { id: string; name: string };
    hoursWorked: string;
    basePay: string;
    tipShare: string;
    unpaidLeaveDeduction: string;
    netPay: string;
  }[];
}
export interface PerformanceRow {
  userId: string;
  name: string;
  orders: number;
  sales: number;
  tips: number;
  hoursWorked: number;
  salesPerHour: number | null;
}

const q = (b: string | null) => `branchId=${b}`;

export function useShifts(branchId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["hr", "shifts", branchId, from, to],
    queryFn: () => api.get<Shift[]>(`/hr/shifts?${q(branchId)}&from=${from}&to=${to}`),
    enabled: !!branchId,
  });
}
export function useLeave(branchId: string | null) {
  return useQuery({
    queryKey: ["hr", "leave", branchId],
    queryFn: () => api.get<LeaveRow[]>(`/hr/leave?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export function useMyLeave() {
  return useQuery({ queryKey: ["hr", "leave", "mine"], queryFn: () => api.get<LeaveRow[]>("/hr/leave/mine") });
}
export function usePay(branchId: string | null) {
  return useQuery({
    queryKey: ["hr", "pay", branchId],
    queryFn: () => api.get<PayRow[]>(`/hr/pay?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export function usePayrollRuns(branchId: string | null) {
  return useQuery({
    queryKey: ["hr", "payroll", branchId],
    queryFn: () => api.get<PayrollRunRow[]>(`/hr/payroll?${q(branchId)}`),
    enabled: !!branchId,
  });
}
export function usePayrollRun(branchId: string | null, id: string | null) {
  return useQuery({
    queryKey: ["hr", "payroll", branchId, id],
    queryFn: () => api.get<PayrollRunDetail>(`/hr/payroll/${id}?${q(branchId)}`),
    enabled: !!branchId && !!id,
  });
}
export function usePerformance(branchId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["hr", "performance", branchId, from, to],
    queryFn: () => api.get<PerformanceRow[]>(`/hr/performance?${q(branchId)}&from=${from}&to=${to}`),
    enabled: !!branchId,
  });
}

export function useHrActions(branchId: string | null) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["hr"] });
  return {
    addShift: useMutation({
      mutationFn: (dto: { userId: string; startsAt: string; endsAt: string; note?: string }) =>
        api.post(`/hr/shifts?${q(branchId)}`, dto),
      onSuccess: done,
    }),
    deleteShift: useMutation({
      mutationFn: (id: string) => api.delete(`/hr/shifts/${id}?${q(branchId)}`),
      onSuccess: done,
    }),
    requestLeave: useMutation({
      mutationFn: (dto: { type: string; startDate: string; endDate: string; reason?: string }) =>
        api.post("/hr/leave", { ...dto, branchId }),
      onSuccess: done,
    }),
    decideLeave: useMutation({
      mutationFn: (v: { id: string; status: "APPROVED" | "REJECTED" }) =>
        api.patch(`/hr/leave/${v.id}?${q(branchId)}`, { status: v.status }),
      onSuccess: done,
    }),
    setPay: useMutation({
      mutationFn: (v: { userId: string; payType: "MONTHLY" | "HOURLY"; rate: number }) =>
        api.put(`/hr/pay/${v.userId}?${q(branchId)}`, { payType: v.payType, rate: v.rate }),
      onSuccess: done,
    }),
    createRun: useMutation({
      mutationFn: (v: { periodStart: string; periodEnd: string }) => api.post(`/hr/payroll?${q(branchId)}`, v),
      onSuccess: done,
    }),
    finalizeRun: useMutation({
      mutationFn: (id: string) => api.post(`/hr/payroll/${id}/finalize?${q(branchId)}`),
      onSuccess: done,
    }),
    deleteRun: useMutation({
      mutationFn: (id: string) => api.delete(`/hr/payroll/${id}?${q(branchId)}`),
      onSuccess: done,
    }),
  };
}
