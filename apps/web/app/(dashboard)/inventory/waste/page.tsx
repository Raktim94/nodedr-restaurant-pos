"use client";

import { useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { LogWasteDialog, WASTE_REASONS } from "@/components/inventory/log-waste-dialog";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { csvUrl, useStockItems, useWasteAction, useWasteEntries, useWasteReport, type WasteEntry } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const STATUS: Record<WasteEntry["status"], string> = { POSTED: "Recorded", PENDING_APPROVAL: "Needs review", REJECTED: "Rejected", REVERSED: "Reversed" };
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
  const filters = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString(), ingredientId, reason, shift, kind };
  const { data: items } = useStockItems(branchId);
  const { data: entries, isLoading, isError } = useWasteEntries(branchId, filters);
  const { data: report } = useWasteReport(branchId, filters);
  const act = useWasteAction(branchId);
  const [why, setWhy] = useState<Record<string, string>>({});
  const run = (id: string, action: "approve" | "reject" | "reverse") => {
    const text = why[id]?.trim() ?? "";
    if (action === "reverse" && text.length < 3) return toast.error("Type a reason to reverse");
    act.mutate({ id, action, body: action === "reverse" ? { reason: text } : { note: text || undefined } }, {
      onSuccess: () => toast.success("Done"),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update"),
    });
  };
  const max = Math.max(1, ...(report?.trend ?? []).map((t) => t.entries));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        <LogWasteDialog branchId={branchId} />
      </div>
      <InventoryTabs />

      <Card className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-7">
        <div className="flex flex-col gap-1.5"><Label htmlFor="w-from">From</Label><Input id="w-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="w-to">To</Label><Input id="w-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="w-i">Item</Label>
          <select id="w-i" className={selectClass} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}><option value="">All</option>{(items ?? []).map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="w-r">Reason</Label>
          <select id="w-r" className={selectClass} value={reason} onChange={(e) => setReason(e.target.value)}><option value="">All</option>{WASTE_REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="w-s">Shift</Label>
          <select id="w-s" className={selectClass} value={shift} onChange={(e) => setShift(e.target.value)}><option value="">All</option>{["Morning", "Afternoon", "Evening", "Night"].map((s) => (<option key={s}>{s}</option>))}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="w-k">Type</Label>
          <select id="w-k" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option><option value="INGREDIENT">Ingredients</option><option value="FINISHED">Finished food</option></select></div>
        <div className="flex items-end"><a className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" href={csvUrl("waste/export.csv", branchId, filters)}>Export CSV</a></div>
      </Card>

      {report && report.entryCount > 0 && (
        <section aria-label="Waste summary" className="grid gap-4 md:grid-cols-3">
          <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">By item</h2>
            <ul className="flex flex-col gap-1 text-sm">{report.byItem.map((r) => (<li key={r.key + r.unit} className="flex justify-between"><span>{r.label}</span><span className="tabular-nums">{r.quantity} {r.unit}</span></li>))}</ul></Card>
          <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">By reason</h2>
            <ul className="flex flex-col gap-1 text-sm">{report.byReason.map((r) => (<li key={r.key + r.unit} className="flex justify-between"><span>{WASTE_REASONS.find((x) => x.value === r.key)?.label ?? r.key}</span><span className="tabular-nums">{r.quantity} {r.unit}</span></li>))}</ul></Card>
          <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">Entries per day</h2>
            <ul className="flex flex-col gap-1 text-sm">{report.trend.map((t) => (<li key={t.day} className="flex items-center gap-2"><span className="w-20 text-muted-foreground">{t.day.slice(5)}</span><span className="h-2 rounded bg-primary" style={{ width: `${(t.entries / max) * 100}%` }} /><span className="tabular-nums">{t.entries}</span></li>))}</ul></Card>
          <p className="text-xs text-muted-foreground md:col-span-3">Quantities only; no cost is shown.{report.alreadyInProduction > 0 && ` ${report.alreadyInProduction} loss(es) already inside production entries are not counted again.`}{report.pendingApproval > 0 && ` ${report.pendingApproval} waiting for review.`}</p>
        </section>
      )}

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : isError ? (
          <p className="p-6 text-sm text-destructive">Could not load waste entries.</p>
        ) : entries && entries.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>By</TableHead>{canReview && <TableHead>Review</TableHead>}</TableRow></TableHeader>
            <TableBody>
              {entries.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(w.occurredAt).toLocaleString()}{w.shift ? ` · ${w.shift}` : ""}</TableCell>
                  <TableCell className="font-medium">{w.ingredient.name}<span className="block text-xs text-muted-foreground">{w.kind === "FINISHED" ? "Finished food" : "Ingredient"}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{w.enteredQuantity} {w.enteredUnit}</TableCell>
                  <TableCell>{WASTE_REASONS.find((r) => r.value === w.reason)?.label}{w.includedInProduction && <span className="block text-xs text-muted-foreground">Already in production</span>}{w.note && <span className="block text-xs text-muted-foreground">{w.note}</span>}</TableCell>
                  <TableCell><Badge variant={w.status === "PENDING_APPROVAL" ? "default" : "outline"}>{STATUS[w.status]}</Badge>{w.reverseReason && <span className="block text-xs text-muted-foreground">{w.reverseReason}</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{w.createdByName}</TableCell>
                  {canReview && (
                    <TableCell>
                      {(w.status === "POSTED" || w.status === "PENDING_APPROVAL") && (
                        <div className="flex min-w-56 flex-col gap-1">
                          <Input aria-label="Reason or note" placeholder="Reason / note" value={why[w.id] ?? ""} onChange={(e) => setWhy({ ...why, [w.id]: e.target.value })} />
                          <div className="flex gap-1">
                            {w.status === "PENDING_APPROVAL" && <><Button size="xs" onClick={() => run(w.id, "approve")}>Approve</Button><Button size="xs" variant="outline" onClick={() => run(w.id, "reject")}>Reject</Button></>}
                            <Button size="xs" variant="destructive" onClick={() => run(w.id, "reverse")}>Reverse</Button>
                          </div>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No waste recorded for these filters</p>
            <p className="text-sm text-muted-foreground">Use Record waste when food is thrown away.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
