"use client";

import { useState } from "react";
import { 
  Calendar, 
  CheckCircle2, 
  Clock, 
  FileText, 
  LogOut, 
  LogIn, 
  UserCheck, 
  Timer, 
  User, 
  AlertCircle 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useAttendance, useClock, useMyShift } from "@/hooks/use-attendance";
import { useBranch } from "@/hooks/use-branch";
import { useHrActions, useMyLeave } from "@/hooks/use-hr";
import { toast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function duration(from: string, to: string | null) {
  const mins = Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function LeaveRequestCard({ branchId }: { branchId: string | null }) {
  const { data: mine } = useMyLeave();
  const { requestLeave } = useHrActions(branchId);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ type: "ANNUAL", startDate: today, endDate: today, reason: "" });

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5 rounded-2xl border border-border/80 shadow-2xs">
      <div className="flex items-center gap-2 pb-1 border-b border-border/60">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
          <Calendar className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">Request Time Off / Leave</h2>
          <p className="text-xs text-muted-foreground">Submit planned leave dates for manager review and payroll deduction tracking</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-muted-foreground">Leave Type</label>
          <select
            aria-label="Leave type"
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value })}
            className="h-11 sm:h-9 rounded-xl border border-input bg-card px-3 text-xs sm:text-sm font-medium text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2"
          >
            <option value="ANNUAL">Annual Leave</option>
            <option value="SICK">Sick Leave</option>
            <option value="UNPAID">Unpaid Leave</option>
            <option value="OTHER">Other / Compassionate</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-muted-foreground">From Date</label>
          <Input 
            type="date" 
            aria-label="Start Date"
            value={f.startDate} 
            onChange={(e) => setF({ ...f, startDate: e.target.value })} 
            className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium tabular-nums" 
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-muted-foreground">To Date</label>
          <Input 
            type="date" 
            aria-label="End Date"
            value={f.endDate} 
            onChange={(e) => setF({ ...f, endDate: e.target.value })} 
            className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium tabular-nums" 
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold text-muted-foreground">Reason / Notes</label>
          <Input 
            placeholder="Reason (optional)" 
            value={f.reason} 
            onChange={(e) => setF({ ...f, reason: e.target.value })} 
            className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl" 
          />
        </div>
      </div>

      <Button
        disabled={!branchId || requestLeave.isPending}
        onClick={() =>
          requestLeave.mutate(
            { ...f, reason: f.reason || undefined },
            {
              onSuccess: () => {
                toast.success("Leave requested");
                setF({ type: "ANNUAL", startDate: today, endDate: today, reason: "" });
              },
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not request leave"),
            },
          )
        }
        className="h-11 sm:h-9 rounded-xl text-xs font-semibold self-start px-5 active:scale-98"
      >
        {requestLeave.isPending ? "Submitting…" : "Submit Leave Request"}
      </Button>

      {mine && mine.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border/60">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Recent Requests</span>
          <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden bg-muted/10">
            {mine.slice(0, 5).map((l) => (
              <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 sm:px-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground capitalize">{l.type.toLowerCase()} Leave</span>
                  <span className="text-muted-foreground font-mono">
                    {l.startDate.slice(0, 10)} → {l.endDate.slice(0, 10)}
                  </span>
                  {l.reason && <span className="text-muted-foreground italic truncate max-w-xs">({l.reason})</span>}
                </div>
                <div>
                  <Badge
                    variant={l.status === "APPROVED" ? "default" : l.status === "REJECTED" ? "destructive" : "secondary"}
                    className="text-[10px] uppercase font-bold px-2 py-0.5"
                  >
                    {l.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AttendancePage() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canManage = hasPermission(me?.user, "attendance.manage");
  const { data: shift, isLoading: shiftLoading } = useMyShift();
  const { clockIn, clockOut } = useClock(branchId);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: records, isLoading } = useAttendance(branchId, date, canManage);

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-24 sm:pb-20 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-1 pb-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Attendance &amp; Shifts</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Real-time timeclock, personal shift history, and leave submissions
        </p>
      </div>

      {/* Primary Punch Card / Timeclock Banner (Apple HIG Prominence) */}
      <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 sm:p-6 rounded-2xl border border-border/80 shadow-2xs bg-card">
        {shiftLoading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <Skeleton className="h-10 w-48 rounded-xl" />
          </div>
        ) : shift ? (
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 shrink-0">
              <UserCheck className="h-6 w-6" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold text-foreground">Currently On Shift</span>
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] uppercase font-bold">
                  Active
                </Badge>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Clocked in at <strong className="text-foreground font-semibold">{time(shift.clockInAt)}</strong> · Elapsed: <strong className="text-foreground font-semibold">{duration(shift.clockInAt, null)}</strong>
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground shrink-0">
              <Timer className="h-6 w-6" />
            </div>
            <div className="flex flex-col">
              <span className="text-base sm:text-lg font-bold text-foreground">You are not clocked in</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Record your start time to accurately track worked hours and meal breaks
              </p>
            </div>
          </div>
        )}

        <div className="w-full sm:w-auto">
          {shift ? (
            <Button 
              variant="outline" 
              disabled={clockOut.isPending} 
              onClick={() => clockOut.mutate()}
              className="w-full sm:w-auto h-11 sm:h-10 rounded-xl text-xs font-semibold gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 active:scale-98"
            >
              <LogOut className="h-4 w-4" />
              <span>{clockOut.isPending ? "Clocking out…" : "Clock Out of Shift"}</span>
            </Button>
          ) : (
            <Button 
              disabled={!branchId || clockIn.isPending || shiftLoading} 
              onClick={() => clockIn.mutate()}
              className="w-full sm:w-auto h-11 sm:h-10 rounded-xl text-xs font-semibold gap-2 active:scale-98"
            >
              <LogIn className="h-4 w-4" />
              <span>{clockIn.isPending ? "Clocking in…" : "Clock In Now"}</span>
            </Button>
          )}
        </div>
      </Card>

      {/* Leave Request Card */}
      <LeaveRequestCard branchId={branchId} />

      {/* Manager / Supervisor Daily Branch Roster Audit */}
      {canManage && (
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <h2 className="text-sm font-bold text-foreground">Branch Staff Roster &amp; Hours</h2>
              <p className="text-xs text-muted-foreground">Daily attendance logs for shifts worked on this branch</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Filter date"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium w-full sm:w-40 tabular-nums"
              />
            </div>
          </div>

          <Card className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden divide-y divide-border/60">
            {isLoading ? (
              <div className="p-4 flex flex-col gap-3">
                <Skeleton className="h-10 rounded-xl" />
                <Skeleton className="h-10 rounded-xl" />
              </div>
            ) : records && records.length > 0 ? (
              records.map((r) => (
                <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 sm:px-4 text-xs sm:text-sm hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary text-foreground font-bold text-xs shrink-0">
                      {r.user.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">{r.user.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {time(r.clockInAt)} – {r.clockOutAt ? time(r.clockOutAt) : "Present / On shift"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0 border-t border-border/40 sm:border-0">
                    <span className="text-xs text-muted-foreground sm:hidden">Total Duration:</span>
                    <Badge variant={r.clockOutAt ? "secondary" : "default"} className={cn("text-[11px] font-mono px-2.5 py-0.5", !r.clockOutAt && "bg-emerald-600 text-white")}>
                      {duration(r.clockInAt, r.clockOutAt)}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <User className="h-5 w-5" />
                </div>
                <span className="text-xs sm:text-sm font-semibold text-foreground">No attendance records</span>
                <p className="text-xs text-muted-foreground">
                  No shifts were clocked in or out on {date}.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
