"use client";

import { useSearchParams } from "next/navigation";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { AdjustLineDialog, PayRunDialog, SlipButton } from "@/components/team/payroll-dialogs";
import { Suspense, useState } from "react";
import { 
  Calendar, 
  CalendarDays, 
  Clock, 
  DollarSign, 
  FileText, 
  Plus, 
  Trash2, 
  TrendingUp, 
  UserCheck, 
  Users, 
  Wallet,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useBranch } from "@/hooks/use-branch";
import {
  useHrActions,
  useLeave,
  usePay,
  usePayrollRun,
  usePayrollRuns,
  usePerformance,
  useShifts,
} from "@/hooks/use-hr";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");
const fmtDate = (s: string) => new Date(s).toLocaleDateString([], { day: "numeric", month: "short" });
const fmtTime = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const TABS = [
  { id: "schedule", label: "Work Schedule", icon: CalendarDays },
  { id: "leave", label: "Leave Requests", icon: Calendar },
  { id: "payroll", label: "Payroll & Compensation", icon: Wallet },
  { id: "performance", label: "Staff Analytics", icon: TrendingUp },
] as const;

type Tab = (typeof TABS)[number]["id"];

function Schedule({ branchId }: { branchId: string | null }) {
  const [from, setFrom] = useState(() => iso(new Date()));
  const to = iso(addDays(new Date(from), 6));
  const { data: shifts, isLoading } = useShifts(branchId, from, to);
  const { data: staff } = usePay(branchId);
  const { addShift, deleteShift } = useHrActions(branchId);
  const [form, setForm] = useState({ userId: "", date: iso(new Date()), start: "09:00", end: "17:00" });

  const submit = () => {
    if (!form.userId) return toast.error("Pick a staff member");
    addShift.mutate(
      {
        userId: form.userId,
        startsAt: new Date(`${form.date}T${form.start}`).toISOString(),
        endsAt: new Date(`${form.date}T${form.end}`).toISOString(),
      },
      { 
        onSuccess: () => {
          toast.success("Shift added");
          setForm((current) => ({ ...current, userId: "" }));
        }, 
        onError: (e) => toast.error(errMsg(e)) 
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Shift Creator Form Card */}
      <Card className="flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2 pb-1 border-b border-border/60">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Plus className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Assign Staff Shift</h3>
            <p className="text-xs text-muted-foreground">Schedule work hours for staff members for this branch</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground">Staff Member</label>
            <select
              aria-label="Staff"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              className="h-11 sm:h-9 rounded-xl border border-input bg-card px-3 text-xs sm:text-sm font-medium text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2"
            >
              <option value="">Select staff member…</option>
              {staff?.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground">Shift Date</label>
            <Input 
              type="date" 
              value={form.date} 
              onChange={(e) => setForm({ ...form, date: e.target.value })} 
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground">Start Time</label>
            <Input 
              type="time" 
              value={form.start} 
              onChange={(e) => setForm({ ...form, start: e.target.value })} 
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium tabular-nums"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-muted-foreground">End Time</label>
            <Input 
              type="time" 
              value={form.end} 
              onChange={(e) => setForm({ ...form, end: e.target.value })} 
              className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium tabular-nums"
            />
          </div>

          <div className="flex items-end">
            <Button 
              onClick={submit} 
              disabled={addShift.isPending}
              className="h-11 sm:h-9 rounded-xl text-xs font-semibold w-full active:scale-98"
            >
              {addShift.isPending ? "Assigning…" : "Assign Shift"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Week Navigator */}
      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-muted/40 border border-border/50">
        <Button 
          size="sm" 
          variant="ghost" 
          onClick={() => setFrom(iso(addDays(new Date(from), -7)))}
          className="h-9 px-3 rounded-lg text-xs font-medium gap-1 active:scale-98"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Previous Week</span>
        </Button>
        <span className="text-xs font-bold text-foreground">
          {fmtDate(from)} – {fmtDate(to)}
        </span>
        <Button 
          size="sm" 
          variant="ghost" 
          onClick={() => setFrom(iso(addDays(new Date(from), 7)))}
          className="h-9 px-3 rounded-lg text-xs font-medium gap-1 active:scale-98"
        >
          <span>Next Week</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Scheduled Shifts List */}
      <Card className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden divide-y divide-border/60">
        {isLoading ? (
          <div className="p-4 flex flex-col gap-3">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        ) : shifts && shifts.length > 0 ? (
          shifts.map((s) => (
            <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 sm:px-4 text-xs sm:text-sm hover:bg-muted/20 transition-colors">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold text-xs shrink-0">
                  {s.user.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground">{s.user.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(s.startsAt)} · {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 pt-1 sm:pt-0 border-t border-border/40 sm:border-0">
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => deleteShift.mutate(s.id)}
                  className="h-9 rounded-xl text-xs text-muted-foreground hover:text-destructive hover:border-destructive/30 active:scale-98"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                  <span>Remove</span>
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <CalendarDays className="h-5 w-5" />
            </div>
            <span className="text-xs sm:text-sm font-semibold text-foreground">No shifts scheduled</span>
            <p className="text-xs text-muted-foreground">No roster entries defined for this week period.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Leave({ branchId }: { branchId: string | null }) {
  const { data, isLoading } = useLeave(branchId);
  const { decideLeave } = useHrActions(branchId);

  return (
    <Card className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden divide-y divide-border/60">
      {isLoading ? (
        <div className="p-4 flex flex-col gap-3">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      ) : data && data.length > 0 ? (
        data.map((l) => (
          <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 text-xs sm:text-sm hover:bg-muted/20 transition-colors">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{l.user?.name}</span>
                <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                  {l.type.toLowerCase()}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                {l.reason && <span className="text-foreground/80 italic ml-1.5">({l.reason})</span>}
              </p>
            </div>

            {l.status === "PENDING" ? (
              <div className="flex items-center gap-2 pt-1 sm:pt-0">
                <Button 
                  size="sm" 
                  onClick={() => decideLeave.mutate({ id: l.id, status: "APPROVED" }, { onError: (e) => toast.error(errMsg(e)) })}
                  className="h-11 sm:h-9 rounded-xl text-xs font-semibold px-4 active:scale-98"
                >
                  Approve
                </Button>
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={() => decideLeave.mutate({ id: l.id, status: "REJECTED" }, { onError: (e) => toast.error(errMsg(e)) })}
                  className="h-11 sm:h-9 rounded-xl text-xs font-medium px-4 active:scale-98"
                >
                  Reject
                </Button>
              </div>
            ) : (
              <Badge
                variant={l.status === "APPROVED" ? "default" : "destructive"}
                className="text-[10px] uppercase font-bold px-2 py-0.5 w-fit"
              >
                {l.status}
              </Badge>
            )}
          </div>
        ))
      ) : (
        <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Calendar className="h-5 w-5" />
          </div>
          <span className="text-xs sm:text-sm font-semibold text-foreground">No leave requests</span>
          <p className="text-xs text-muted-foreground">All pending employee time-off applications have been resolved.</p>
        </div>
      )}
    </Card>
  );
}

function RunDetail({ branchId, id }: { branchId: string | null; id: string }) {
  const { data } = usePayrollRun(branchId, id);
  const { finalizeRun, deleteRun } = useHrActions(branchId);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const { note, clear, toast: runToast } = useNoteToast();

  if (!data) return <Skeleton className="h-32 rounded-2xl" />;
  const editable = data.status === "DRAFT";
  const adjustingLine = data.lines.find((l) => l.user.id === adjusting);

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5 rounded-2xl border border-border/80 shadow-2xs bg-card">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border/60">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-foreground">
              Period: {fmtDate(data.periodStart)} – {fmtDate(data.periodEnd)}
            </span>
            <Badge variant={data.status === "PAID" ? "default" : data.status === "FINALIZED" ? "secondary" : "outline"} className="text-[10px] uppercase font-bold">
              {data.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tip pool distribution: <strong className="text-foreground">{formatCurrency(data.tipPool)}</strong>
            {data.status === "PAID" && data.paidAt
              ? ` · Paid on ${fmtDate(data.paidAt)}${data.paymentMethod ? ` via ${data.paymentMethod.replace("_", " ").toLowerCase()}` : ""}`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {data.status === "DRAFT" && (
            <>
              <Button 
                size="sm" 
                onClick={() => finalizeRun.mutate(id, { onSuccess: () => runToast.success("Payroll finalized - adjustments are now locked"), onError: (e) => runToast.error(errMsg(e)) })}
                className="h-11 sm:h-9 rounded-xl text-xs font-semibold active:scale-98"
              >
                Finalize Run
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => deleteRun.mutate(id, { onError: (e) => runToast.error(errMsg(e)) })}
                className="h-11 sm:h-9 rounded-xl text-xs font-medium text-muted-foreground hover:text-destructive active:scale-98"
              >
                Discard Draft
              </Button>
            </>
          )}
          {data.status === "FINALIZED" && (
            <Button 
              size="sm" 
              onClick={() => setPaying(true)}
              className="h-11 sm:h-9 rounded-xl text-xs font-semibold active:scale-98"
            >
              Mark as Paid
            </Button>
          )}
        </div>
      </div>

      <StatusNote note={note} onClear={clear} />

      <div className="overflow-x-auto scrollbar-none">
        <table className="w-full text-xs sm:text-sm border-collapse">
          <thead>
            <tr className="border-b border-border/80 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <th className="py-2.5 px-2">Staff</th>
              <th className="py-2.5 px-2 text-right">Hours</th>
              <th className="py-2.5 px-2 text-right">Base</th>
              <th className="py-2.5 px-2 text-right">Leave −</th>
              <th className="py-2.5 px-2 text-right">Tips</th>
              <th className="py-2.5 px-2 text-right">Allow. +</th>
              <th className="py-2.5 px-2 text-right">Bonus +</th>
              <th className="py-2.5 px-2 text-right">Advance −</th>
              <th className="py-2.5 px-2 text-right">Other −</th>
              <th className="py-2.5 px-2 text-right font-bold text-foreground">Net Pay</th>
              <th className="py-2.5 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.lines.map((l) => (
              <tr key={l.id} className="hover:bg-muted/20 transition-colors">
                <td className="py-2.5 px-2 font-semibold text-foreground whitespace-nowrap">{l.user.name}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{l.hoursWorked}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(l.basePay)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">{formatCurrency(l.unpaidLeaveDeduction)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums text-emerald-600">{formatCurrency(l.tipShare)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(l.allowances)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(l.bonus)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums text-destructive">{formatCurrency(l.advanceRecovery)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums text-destructive">{formatCurrency(l.otherDeductions)}</td>
                <td className="py-2.5 px-2 text-right font-bold tabular-nums text-foreground">{formatCurrency(l.netPay)}</td>
                <td className="py-2.5 px-2 whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-1">
                    {editable && (
                      <Button size="sm" variant="ghost" className="h-8 px-2 text-xs rounded-lg" onClick={() => setAdjusting(l.user.id)}>
                        Adjust
                      </Button>
                    )}
                    <SlipButton branchId={branchId} runId={id} userId={l.user.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/60">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net Payroll Aggregate</span>
        <span className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(data.totalNet)}</span>
      </div>

      {adjustingLine && (
        <AdjustLineDialog key={adjustingLine.id} branchId={branchId} runId={id} line={adjustingLine} onClose={() => setAdjusting(null)} />
      )}
      {paying && <PayRunDialog branchId={branchId} runId={id} total={data.totalNet} onClose={() => setPaying(false)} />}
    </Card>
  );
}

function Payroll({ branchId }: { branchId: string | null }) {
  const { data: pay } = usePay(branchId);
  const { data: runs } = usePayrollRuns(branchId);
  const { setPay, createRun } = useHrActions(branchId);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { start: iso(first), end: iso(last) };
  });
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { payType: "MONTHLY" | "HOURLY"; rate: string; ot: string; mult: string; grace: string; absent: boolean }>>({});

  return (
    <div className="flex flex-col gap-4">
      {/* Pay Rates Configuration Card */}
      <Card className="flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border border-border/80 shadow-2xs">
        <div className="flex items-center gap-2 pb-1 border-b border-border/60">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <DollarSign className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Staff Wage &amp; Compensation Matrix</h3>
            <p className="text-xs text-muted-foreground">Configure monthly salary, hourly rates, overtime multipliers, and absence rules</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 divide-y divide-border/60">
          {pay?.map((p) => {
            const d = draft[p.userId] ?? { payType: p.payType ?? "MONTHLY", rate: String(p.rate ?? ""), ot: p.overtimeAfterHours != null ? String(p.overtimeAfterHours) : "", mult: String(p.overtimeMultiplier ?? 1.5), grace: p.lateGraceMinutes != null ? String(p.lateGraceMinutes) : "", absent: !!p.deductAbsence };
            return (
              <div key={p.userId} className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-3 first:pt-0">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary text-foreground font-bold text-xs shrink-0">
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="font-semibold text-sm text-foreground">{p.name}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Pay type"
                    value={d.payType}
                    onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, payType: e.target.value as "MONTHLY" | "HOURLY" } })}
                    className="h-11 sm:h-9 rounded-xl border border-input bg-card px-3 text-xs font-semibold text-foreground outline-none"
                  >
                    <option value="MONTHLY">Monthly Salary</option>
                    <option value="HOURLY">Hourly Wage</option>
                  </select>

                  <Input
                    className="h-11 sm:h-9 w-28 text-xs sm:text-sm rounded-xl font-semibold tabular-nums"
                    inputMode="decimal"
                    placeholder="Rate"
                    value={d.rate}
                    onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, rate: e.target.value } })}
                  />

                  {d.payType === "HOURLY" && (
                    <>
                      <Input aria-label="Overtime after hours a day" className="h-11 sm:h-9 w-28 text-xs rounded-xl" inputMode="decimal" placeholder="OT after h/day" value={d.ot} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, ot: e.target.value } })} />
                      <Input aria-label="Overtime multiplier" className="h-11 sm:h-9 w-20 text-xs rounded-xl" inputMode="decimal" placeholder="x1.5" value={d.mult} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, mult: e.target.value } })} />
                    </>
                  )}

                  {d.payType === "MONTHLY" && (
                    <>
                      <Input aria-label="Late grace minutes" className="h-11 sm:h-9 w-28 text-xs rounded-xl" inputMode="numeric" placeholder="Late after (min)" value={d.grace} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, grace: e.target.value } })} />
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer px-1">
                        <input type="checkbox" className="rounded" checked={d.absent} onChange={(e) => setDraft({ ...draft, [p.userId]: { ...d, absent: e.target.checked } })} />
                        <span>Deduct absence</span>
                      </label>
                    </>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 sm:h-9 rounded-xl text-xs font-semibold px-4 active:scale-98"
                    onClick={() =>
                      setPay.mutate(
                        { userId: p.userId, payType: d.payType, rate: Number(d.rate), overtimeAfterHours: d.ot ? Number(d.ot) : null, overtimeMultiplier: d.mult ? Number(d.mult) : undefined, lateGraceMinutes: d.grace.trim() !== "" ? Number(d.grace) : null, deductAbsence: d.absent },
                        { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(errMsg(e)) },
                      )
                    }
                  >
                    Save Rate
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Run Payroll Generator Card */}
      <Card className="flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border border-border/80 shadow-2xs">
        <div>
          <h3 className="text-sm font-bold text-foreground">Compute New Payroll Cycle</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aggregates clocked hours from Attendance, deducts unpaid leave, and distributes pooled tips.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="flex items-center gap-2">
            <Input type="date" className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium w-full sm:w-40 tabular-nums" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} />
            <span className="text-xs text-muted-foreground font-medium">to</span>
            <Input type="date" className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium w-full sm:w-40 tabular-nums" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} />
          </div>

          <Button
            disabled={createRun.isPending}
            onClick={() =>
              createRun.mutate(
                { periodStart: period.start, periodEnd: period.end },
                {
                  onSuccess: (r) => {
                    setOpen((r as { id: string }).id);
                    for (const w of (r as { warnings?: string[] }).warnings ?? []) toast.error(w);
                  },
                  onError: (e) => toast.error(errMsg(e)),
                },
              )
            }
            className="h-11 sm:h-9 rounded-xl text-xs font-semibold px-5 active:scale-98"
          >
            {createRun.isPending ? "Calculating…" : "Run Payroll"}
          </Button>
        </div>
      </Card>

      {/* History of Payroll Runs */}
      {runs?.map((r) => (
        <div key={r.id} className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen(open === r.id ? null : r.id)}
            className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-4 text-left text-xs sm:text-sm hover:bg-muted/20 active:scale-99 transition-all shadow-2xs"
          >
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-foreground">
                {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}
              </span>
              <Badge variant={r.status === "PAID" ? "default" : "secondary"} className="text-[10px] uppercase font-bold">
                {r.status}
              </Badge>
            </div>
            <span className="font-bold tabular-nums text-foreground">{formatCurrency(r.totalNet)}</span>
          </button>
          {open === r.id && <RunDetail branchId={branchId} id={r.id} />}
        </div>
      ))}
    </div>
  );
}

function Performance({ branchId }: { branchId: string | null }) {
  const [range, setRange] = useState(() => ({ from: iso(addDays(new Date(), -29)), to: iso(new Date()) }));
  const { data, isLoading } = usePerformance(branchId, range.from, range.to);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input type="date" className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium w-full sm:w-40 tabular-nums" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-xs text-muted-foreground font-medium">to</span>
        <Input type="date" className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl font-medium w-full sm:w-40 tabular-nums" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>

      <Card className="rounded-2xl border border-border/80 shadow-2xs overflow-hidden p-0">
        {isLoading ? (
          <div className="p-4 flex flex-col gap-3">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-none">
            <table className="w-full text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/80 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 px-3">Staff</th>
                  <th className="py-3 px-3 text-right">Orders</th>
                  <th className="py-3 px-3 text-right">Sales</th>
                  <th className="py-3 px-3 text-right">Tips</th>
                  <th className="py-3 px-3 text-right">Hours</th>
                  <th className="py-3 px-3 text-right font-bold text-foreground">Sales / hour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data?.map((r) => (
                  <tr key={r.userId} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3 font-semibold text-foreground whitespace-nowrap">{r.name}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{r.orders}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{formatCurrency(r.sales)}</td>
                    <td className="py-3 px-3 text-right tabular-nums text-emerald-600">{formatCurrency(r.tips)}</td>
                    <td className="py-3 px-3 text-right tabular-nums">{r.hoursWorked}</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums text-foreground">
                      {r.salesPerHour == null ? "—" : formatCurrency(r.salesPerHour)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TeamView() {
  const { branchId } = useBranch();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab");
    return TABS.some((x) => x.id === t) ? (t as Tab) : "schedule";
  });

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-24 sm:pb-20 max-w-6xl">
      {/* Page Title */}
      <div className="flex flex-col gap-1 pb-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Team &amp; HR</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Work schedules, time-off requests, payroll cycles, and performance</p>
      </div>

      {/* Apple HIG Segmented Control Bar */}
      <nav
        aria-label="Team sub-navigation"
        className="flex items-center gap-1.5 p-1 bg-muted/60 dark:bg-muted/40 rounded-2xl w-full sm:w-fit overflow-x-auto scrollbar-none border border-border/50"
      >
        {TABS.map((t) => {
          const isSelected = tab === t.id;
          const TabIcon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 sm:px-4 py-1.5 text-xs font-medium transition-all shrink-0 active:scale-97 select-none min-h-[38px]",
                isSelected
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <TabIcon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Selected Tab Content */}
      {tab === "schedule" && <Schedule branchId={branchId} />}
      {tab === "leave" && <Leave branchId={branchId} />}
      {tab === "payroll" && <Payroll branchId={branchId} />}
      {tab === "performance" && <Performance branchId={branchId} />}
    </div>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <TeamView />
    </Suspense>
  );
}
