"use client";

import { useState } from "react";
import { 
  AlertOctagon, 
  AlertTriangle, 
  CheckCircle2, 
  ChevronRight, 
  Clock, 
  Download, 
  ExternalLink, 
  FileText, 
  Filter, 
  History, 
  Layers, 
  Package, 
  Plus, 
  RotateCcw, 
  Trash2, 
  User, 
  XCircle 
} from "lucide-react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { LogWasteDialog, WASTE_REASONS } from "@/components/inventory/log-waste-dialog";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { 
  csvUrl, 
  useStockItems, 
  useWasteAction, 
  useWasteEntries, 
  useWasteReport, 
  type WasteEntry 
} from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const STATUS: Record<WasteEntry["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline"; badgeClass?: string }> = {
  POSTED: { label: "Recorded", variant: "default", badgeClass: "bg-emerald-600 hover:bg-emerald-600 text-white" },
  PENDING_APPROVAL: { label: "Needs Review", variant: "outline", badgeClass: "border-warning text-warning bg-warning/10" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  REVERSED: { label: "Reversed", variant: "secondary" },
};

const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default function WastePage() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canReview = hasPermission(me?.user, "production.void");

  const [from, setFrom] = useState(days(7));
  const [to, setTo] = useState(days(0));
  const [ingredientId, setIngredientId] = useState("");
  const [reason, setReason] = useState("");
  const [shift, setShift] = useState("");
  const [kind, setKind] = useState("");

  const filters = {
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59.999`).toISOString(),
    ingredientId,
    reason,
    shift,
    kind,
  };

  const { data: items } = useStockItems(branchId);
  const { data: entries, isLoading, isError } = useWasteEntries(branchId, filters);
  const { data: report } = useWasteReport(branchId, filters);
  const act = useWasteAction(branchId);
  const [why, setWhy] = useState<Record<string, string>>({});

  const run = (id: string, action: "approve" | "reject" | "reverse") => {
    const text = why[id]?.trim() ?? "";
    if (action === "reverse" && text.length < 3) return toast.error("Please provide a reason to reverse this entry");
    act.mutate(
      { id, action, body: action === "reverse" ? { reason: text } : { note: text || undefined } },
      {
        onSuccess: () => toast.success(`Waste entry ${action === "reverse" ? "reversed" : action + "d"}`),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Action failed"),
      }
    );
  };

  const totalIncidents = entries?.length ?? 0;
  const pendingCount = entries?.filter((w) => w.status === "PENDING_APPROVAL").length ?? 0;
  const maxTrend = Math.max(1, ...(report?.trend ?? []).map((t) => t.entries));

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-20">
      {/* Page Title & Log Waste CTA */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Food Waste & Loss Log
            </h1>
            <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground border-border/70">
              Loss Tracking
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Record kitchen spoilage, prep scraps, and expired stock to monitor food cost leakages
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LogWasteDialog branchId={branchId} />
        </div>
      </div>

      <InventoryTabs />

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">Recorded Waste Incidents</span>
            <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums mt-1">
              {totalIncidents}
            </span>
            <span className="text-[11px] text-muted-foreground mt-0.5">In selected date filter</span>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">Pending Review</span>
            <span className={cn("text-2xl font-bold tracking-tight tabular-nums mt-1", pendingCount > 0 ? "text-warning" : "text-foreground")}>
              {pendingCount}
            </span>
            <span className="text-[11px] text-muted-foreground mt-0.5">Exceeds staff approval threshold</span>
          </div>
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", pendingCount > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">Distinct Items Lost</span>
            <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums mt-1">
              {report?.byItem.length ?? 0}
            </span>
            <span className="text-[11px] text-muted-foreground mt-0.5">Spoiled ingredients or dishes</span>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Date & Reason Filter Card */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-primary" />
            <span>Filter Loss Entries</span>
          </span>

          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
            href={csvUrl("waste/export.csv", branchId, filters)}
            download
          >
            <Download className="h-3 w-3 text-muted-foreground" />
            <span>Export CSV</span>
          </a>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-from" className="text-[11px] text-muted-foreground">From</Label>
            <Input id="w-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs rounded-xl bg-background" />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="w-to" className="text-[11px] text-muted-foreground">To</Label>
            <Input id="w-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs rounded-xl bg-background" />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="w-i" className="text-[11px] text-muted-foreground">Ingredient</Label>
            <select id="w-i" className={cn(selectClass, "h-9 text-xs rounded-xl bg-background")} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
              <option value="">All Items</option>
              {(items ?? []).map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="w-r" className="text-[11px] text-muted-foreground">Waste Reason</Label>
            <select id="w-r" className={cn(selectClass, "h-9 text-xs rounded-xl bg-background")} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">All Reasons</option>
              {WASTE_REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="w-s" className="text-[11px] text-muted-foreground">Shift</Label>
            <select id="w-s" className={cn(selectClass, "h-9 text-xs rounded-xl bg-background")} value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">All Shifts</option>
              {["Morning", "Afternoon", "Evening", "Night"].map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="w-k" className="text-[11px] text-muted-foreground">Category</Label>
            <select id="w-k" className={cn(selectClass, "h-9 text-xs rounded-xl bg-background")} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All Types</option>
              <option value="INGREDIENT">Raw Ingredients</option>
              <option value="FINISHED">Kitchen Prepared Food</option>
            </select>
          </div>
        </div>
      </div>

      {/* Waste Analysis Summary Cards */}
      {report && report.entryCount > 0 && (
        <section aria-label="Waste summary" className="grid gap-3 sm:gap-4 md:grid-cols-3">
          {/* By Item */}
          <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs flex flex-col gap-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-1.5 border-b border-border/60">
              Loss By Item
            </h3>
            <ul className="flex flex-col gap-2 divide-y divide-border/40 text-xs sm:text-sm">
              {report.byItem.map((r) => (
                <li key={r.key + r.unit} className="flex justify-between pt-1.5 first:pt-0">
                  <span className="font-semibold text-foreground">{r.label}</span>
                  <span className="tabular-nums font-bold text-destructive">
                    -{r.quantity} {r.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* By Reason */}
          <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs flex flex-col gap-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-1.5 border-b border-border/60">
              Loss By Root Cause
            </h3>
            <ul className="flex flex-col gap-2 divide-y divide-border/40 text-xs sm:text-sm">
              {report.byReason.map((r) => (
                <li key={r.key + r.unit} className="flex justify-between pt-1.5 first:pt-0">
                  <span className="text-foreground">
                    {WASTE_REASONS.find((x) => x.value === r.key)?.label ?? r.key}
                  </span>
                  <span className="tabular-nums font-semibold text-foreground">
                    {r.quantity} {r.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Trend */}
          <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs flex flex-col gap-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-1.5 border-b border-border/60">
              Loss Incidents Trend
            </h3>
            <ul className="flex flex-col gap-1.5 text-xs">
              {report.trend.map((t) => (
                <li key={t.day} className="flex items-center gap-2">
                  <span className="w-14 text-muted-foreground font-mono text-[11px]">{t.day.slice(5)}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-destructive transition-all"
                      style={{ width: `${Math.max(8, (t.entries / maxTrend) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums font-semibold text-foreground w-6 text-right">{t.entries}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Waste Incidents Table */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Loss Log Entries
          </h2>
        </div>

        {isLoading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : isError ? (
          <Card className="p-8 text-center text-sm text-destructive rounded-2xl border-dashed">
            Could not load waste entries. Please check your connection.
          </Card>
        ) : entries && entries.length > 0 ? (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/80">
                    <TableHead className="font-semibold text-xs text-foreground py-3">Timestamp</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Item</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3 text-right">Quantity</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Root Cause</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Status</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Reported By</TableHead>
                    {canReview && <TableHead className="font-semibold text-xs text-foreground py-3">Review Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((w) => {
                    const st = STATUS[w.status];
                    return (
                      <TableRow key={w.id} className="transition-colors hover:bg-muted/30">
                        <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(w.occurredAt).toLocaleString()}
                          {w.shift && <span className="block text-[11px] text-muted-foreground/80">{w.shift} shift</span>}
                        </TableCell>
                        <TableCell className="py-3">
                          <span className="font-semibold text-foreground text-sm">{w.ingredient.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {w.kind === "FINISHED" ? "Kitchen Prepared Food" : "Raw Material"}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 text-right tabular-nums font-bold text-sm text-destructive">
                          -{w.enteredQuantity} {w.enteredUnit}
                        </TableCell>
                        <TableCell className="py-3 text-xs">
                          <span className="font-medium text-foreground">
                            {WASTE_REASONS.find((r) => r.value === w.reason)?.label ?? w.reason}
                          </span>
                          {w.note && <span className="block text-muted-foreground italic">&ldquo;{w.note}&rdquo;</span>}
                          {w.photoUrl && (
                            <a href={w.photoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-0.5">
                              <span>Photo proof</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge variant={st.variant} className={cn("text-[10px] uppercase font-semibold px-2 py-0.2", st.badgeClass)}>
                            {st.label}
                          </Badge>
                          {w.reverseReason && (
                            <span className="block text-[11px] text-destructive mt-0.5">
                              Reversed: {w.reverseReason}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 text-xs text-muted-foreground">
                          {w.createdByName}
                        </TableCell>
                        {canReview && (
                          <TableCell className="py-3">
                            {(w.status === "POSTED" || w.status === "PENDING_APPROVAL") && (
                              <div className="flex flex-col gap-1.5 min-w-48">
                                <Input
                                  aria-label="Action note"
                                  placeholder="Review note / reversal reason…"
                                  value={why[w.id] ?? ""}
                                  onChange={(e) => setWhy({ ...why, [w.id]: e.target.value })}
                                  className="h-7.5 text-xs rounded-lg"
                                />
                                <div className="flex items-center gap-1.5">
                                  {w.status === "PENDING_APPROVAL" && (
                                    <>
                                      <Button size="xs" onClick={() => run(w.id, "approve")} className="rounded-lg h-7 px-2.5 text-[11px]">
                                        Approve
                                      </Button>
                                      <Button size="xs" variant="outline" onClick={() => run(w.id, "reject")} className="rounded-lg h-7 px-2.5 text-[11px]">
                                        Reject
                                      </Button>
                                    </>
                                  )}
                                  <Button size="xs" variant="destructive" onClick={() => run(w.id, "reverse")} className="rounded-lg h-7 px-2.5 text-[11px]">
                                    Reverse
                                  </Button>
                                </div>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden flex flex-col gap-2.5">
              {entries.map((w) => {
                const st = STATUS[w.status];
                return (
                  <div key={w.id} className="flex flex-col gap-2.5 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm text-foreground">{w.ingredient.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {WASTE_REASONS.find((r) => r.value === w.reason)?.label ?? w.reason}
                        </span>
                      </div>
                      <Badge variant={st.variant} className={cn("text-[10px] uppercase font-semibold px-2 py-0.2", st.badgeClass)}>
                        {st.label}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-muted/40 p-2.5 text-xs">
                      <span className="text-muted-foreground">Discarded Quantity:</span>
                      <span className="text-base font-bold tabular-nums text-destructive">
                        -{w.enteredQuantity} {w.enteredUnit}
                      </span>
                    </div>

                    {w.note && <p className="text-xs italic text-muted-foreground">&ldquo;{w.note}&rdquo;</p>}

                    <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                      <span>{new Date(w.occurredAt).toLocaleString()}</span>
                      <span>By {w.createdByName}</span>
                    </div>

                    {canReview && (w.status === "POSTED" || w.status === "PENDING_APPROVAL") && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-border/40">
                        <Input
                          placeholder="Reversal or approval reason…"
                          value={why[w.id] ?? ""}
                          onChange={(e) => setWhy({ ...why, [w.id]: e.target.value })}
                          className="h-8 text-xs rounded-xl"
                        />
                        <div className="flex items-center gap-2">
                          {w.status === "PENDING_APPROVAL" && (
                            <>
                              <Button size="xs" onClick={() => run(w.id, "approve")} className="flex-1 rounded-xl h-8">
                                Approve
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => run(w.id, "reject")} className="flex-1 rounded-xl h-8">
                                Reject
                              </Button>
                            </>
                          )}
                          <Button size="xs" variant="destructive" onClick={() => run(w.id, "reverse")} className="flex-1 rounded-xl h-8">
                            Reverse Loss
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center rounded-2xl border-dashed bg-card/60">
            <Trash2 className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">Zero Waste Recorded</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              No food loss or spoilage incidents recorded for the selected filter period.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
