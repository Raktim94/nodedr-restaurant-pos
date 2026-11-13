"use client";

import { useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { mfgCsvUrl, useMfgReport, useMfgSettings } from "@/hooks/use-manufacturing";
import { useStockItems } from "@/hooks/use-stock-journal";

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: string | null | undefined, dp = 2) => (v == null ? "–" : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const STATUS: Record<string, string> = { DRAFT: "Draft", POSTED: "Posted", VOIDED: "Reversed" };

function Section({ title, csv, children }: { title: string; csv?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{csv && <a className="text-xs underline" href={csv}>Export CSV</a>}</div>
      {children}
    </section>
  );
}
const Empty = ({ t }: { t: string }) => <Card className="py-8 text-center text-sm text-muted-foreground">{t}</Card>;

export default function ManufacturingReportsPage() {
  const { branchId } = useBranch();
  const { data: s } = useMfgSettings(branchId);
  const { data: items } = useStockItems(branchId);
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => day(new Date()));
  const [itemId, setItemId] = useState("");
  const [status, setStatus] = useState("");
  const filters = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString(), itemId, status };
  const { data, isLoading, isError, error } = useMfgReport(branchId, filters);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Stock Journal Reports</h1>
        <p className="text-sm text-muted-foreground">Production, costs and menu price changes, from posted batches</p>
      </div>
      <InventoryTabs />
      {s && !s.enabled && <Card className="p-4 text-sm text-muted-foreground">Manufacturing is switched off. Past batches are kept and still shown here; turn it on under Inventory &gt; Production to record new costed batches.</Card>}
      <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-from">From</Label><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-to">To</Label><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-item">Finished item</Label><select id="r-item" className={selectClass} value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">All</option>{(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="r-st">Status</Label><select id="r-st" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="POSTED">Posted</option><option value="DRAFT">Draft</option><option value="VOIDED">Reversed</option></select></div>
      </Card>

      {isLoading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : isError ? (
        <Card className="p-6 text-sm text-destructive">{(error as Error)?.message?.includes("permission") || (error as { status?: number })?.status === 403 ? "You do not have permission to view manufacturing reports." : "Could not load the reports. Try again."}</Card>
      ) : data ? (
        <>
          <p className="text-xs text-muted-foreground">{data.note}</p>
          <div className="flex flex-wrap gap-2">{data.statusCounts.map((c) => (<Badge key={c.status} variant="outline">{STATUS[c.status]}: {c.count}</Badge>))}</div>

          <Section title="Batches by day" csv={mfgCsvUrl(branchId, "days", filters)}>
            {data.batchesByDay.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.batchesByDay.map((d) => (<li key={d.date} className="flex justify-between px-4 py-2"><span>{d.date} · {d.batches} batch{d.batches === 1 ? "" : "es"}</span><span className="tabular-nums">{num(d.totalCost)}</span></li>))}</ul></Card> : <Empty t="No posted batches in this period." />}
          </Section>

          <Section title="Finished items: quantity and cost per unit" csv={mfgCsvUrl(branchId, "produced", filters)}>
            {data.produced.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.produced.map((p) => (<li key={p.itemId} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2"><span className="font-medium">{p.name}<span className="block text-xs font-normal text-muted-foreground">{p.batches} batch{p.batches === 1 ? "" : "es"} · total cost {num(p.totalCost)}</span></span><span className="text-right tabular-nums">{p.quantity} {p.unit}<span className="block text-xs text-muted-foreground">{num(p.avgUnitCost, 4)} per unit</span></span></li>))}</ul></Card> : <Empty t="Nothing produced in this period." />}
          </Section>

          <Section title="Ingredients consumed" csv={mfgCsvUrl(branchId, "consumed", filters)}>
            {data.consumed.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.consumed.map((c, i) => (<li key={i} className="flex justify-between gap-3 px-4 py-2"><span>{c.date} · {c.name}</span><span className="tabular-nums">{c.quantity} {c.unit} · {num(c.cost)}</span></li>))}</ul></Card> : <Empty t="No ingredients consumed in this period." />}
          </Section>

          <Section title="Additional production costs by category" csv={mfgCsvUrl(branchId, "costs", filters)}>
            {data.additionalByCategory.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.additionalByCategory.map((c) => (<li key={c.category} className="flex justify-between px-4 py-2"><span>{c.category}</span><span className="tabular-nums">{num(c.amount)}</span></li>))}</ul></Card> : <Empty t="No additional costs were counted in this period." />}
          </Section>

          <Section title="Production history" csv={mfgCsvUrl(branchId, "batches", filters)}>
            {data.batches.length ? <ul className="flex flex-col gap-2">{data.batches.map((b) => (
              <li key={b.id}><Card className="flex flex-col gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{b.entryNo}</span><Badge variant={b.status === "POSTED" ? "default" : "outline"}>{STATUS[b.status]}</Badge><span className="text-muted-foreground">{new Date(b.producedAt).toLocaleString()}</span></div>
                <div>{b.quantity} {b.unit} {b.item}</div>
                <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-4"><span>Ingredients {num(b.ingredientCost)}</span><span>Additional {num(b.additionalCost)}</span><span>Total {num(b.totalCost)}</span><span>Per unit <b className="text-foreground">{num(b.unitCost, 4)}</b></span></div>
                {b.corrects && <div className="text-xs text-muted-foreground">Corrects {b.corrects}</div>}
                {b.correctedBy.length > 0 && <div className="text-xs text-muted-foreground">Replaced by {b.correctedBy.join(", ")}</div>}
                {b.voidReason && <div className="text-xs text-muted-foreground">Reversed: {b.voidReason}</div>}
              </Card></li>))}</ul> : <Empty t="No batches match these filters." />}
          </Section>

          <Section title="Menu price changes made from the Stock Journal" csv={mfgCsvUrl(branchId, "prices", filters)}>
            {data.priceChanges.length ? <Card className="p-0"><ul className="divide-y divide-border text-sm">{data.priceChanges.map((p) => (<li key={p.id} className="grid gap-1 px-4 py-2 sm:grid-cols-[1fr_auto]"><span className="font-medium">{p.item}<span className="block text-xs font-normal text-muted-foreground">{p.by} · {new Date(p.changedAt).toLocaleString()} · batch {p.entryNo ?? "–"}</span></span><span className="tabular-nums">{num(p.oldPrice)} → <b>{num(p.newPrice)}</b><span className="block text-xs text-muted-foreground">unit cost then {num(p.unitCost, 4)}</span></span></li>))}</ul></Card> : <Empty t="No menu prices were changed from the Stock Journal in this period." />}
          </Section>
        </>
      ) : null}
    </div>
  );
}
