"use client";

import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type DailyVoucher, dailyCsvUrl, useDailyReport } from "@/hooks/use-manufacturing";
import { usePlaces, useStockItems } from "@/hooks/use-stock-journal";

const iso = (d: Date) => d.toLocaleDateString("en-CA");
const n2 = (v: string | null | undefined) => (v == null || v === "" ? "–" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sgn = (v: string | null) => (v == null ? "–" : `${Number(v) > 0 ? "+" : ""}${v}`);

/** "On this day, what was consumed and what was produced": one block per local date, posted vouchers only, with filters, drill-down and CSV. */
export function DailyProduction({ branchId }: { branchId: string | null }) {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [productId, setProductId] = useState("");
  const [batchRef, setBatchRef] = useState("");
  const [po, setPo] = useState("");
  const [locationId, setLocationId] = useState("");
  const filters = { from, to, productId, batchRef, po, locationId };
  const { data: items } = useStockItems(branchId);
  const { data: places } = usePlaces(branchId);
  const { data, isLoading, isError } = useDailyReport(branchId, filters);

  return (
    <section aria-label="Daily production" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Daily production: what was consumed and what was made</h2>
        <a className="text-xs underline" href={dailyCsvUrl(branchId, filters)}>Export CSV (these filters)</a>
      </div>
      <Card className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-from">From</Label><Input id="d-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-to">To</Label><Input id="d-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-prod">Product</Label><select id="d-prod" className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">All</option>{(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-batch">Batch / reference</Label><Input id="d-batch" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} placeholder="contains…" /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-po">PO or supplier</Label><Input id="d-po" value={po} onChange={(e) => setPo(e.target.value)} placeholder="PO-0001 or name" /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="d-place">Place</Label><select id="d-place" className={selectClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">All</option>{(places ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </Card>
      {isLoading ? <Card className="py-8 text-center text-sm text-muted-foreground">Loading…</Card>
        : isError ? <Card className="p-4 text-sm text-destructive">Could not load the daily report (it needs the report permission).</Card>
        : data && data.days.length ? (
          <>
            {data.days.map((d) => (
              <Card key={d.date} className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
                  <span className="font-semibold">{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="text-xs text-muted-foreground">{d.vouchers.length} voucher{d.vouchers.length === 1 ? "" : "s"} · total production cost <b className="text-foreground">{n2(d.totalCost)}</b></span>
                </div>
                <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
                  <div><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Consumed (all vouchers this day)</h3><ul className="divide-y divide-border">{d.consumed.map((c) => <li key={c.ingredientId} className="flex justify-between gap-2 py-1"><span>{c.name}</span><span className="tabular-nums">{c.quantity} {c.unit} · {n2(c.cost)}</span></li>)}</ul></div>
                  <div><h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Produced (good · rejected)</h3><ul className="divide-y divide-border">{d.produced.map((p) => <li key={p.ingredientId} className="flex justify-between gap-2 py-1"><span>{p.name}</span><span className="text-right tabular-nums">{p.good} {p.unit}{Number(p.rejected) > 0 ? ` · ${p.rejected} rejected` : ""}<span className="block text-xs text-muted-foreground">cost {n2(p.allocatedCost)} · {n2(p.unitCost)} per good unit</span></span></li>)}</ul></div>
                </div>
                <ul className="divide-y divide-border border-t border-border">{d.vouchers.map((v) => <VoucherBlock key={v.id} v={v} />)}</ul>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">Range total: {data.totals.vouchers} vouchers, production cost {n2(data.totals.totalCost)}. {data.note} Days are cut in {data.timezone}.</p>
          </>
        ) : <Card className="py-8 text-center text-sm text-muted-foreground">No posted vouchers match these filters.</Card>}
    </section>
  );
}

function VoucherBlock({ v }: { v: DailyVoucher }) {
  return (
    <li className="px-4 py-2 text-sm">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{v.entryNo}</span>
          {v.batchRef && <span className="text-muted-foreground">batch {v.batchRef}</span>}
          {v.sourcePo && <Badge variant="outline">{v.sourcePo}{v.sourceSupplier ? ` · ${v.sourceSupplier}` : ""}</Badge>}
          <Badge variant="outline">{v.recipe ? `Recipe: ${v.recipe.name}` : "No recipe baseline"}</Badge>
          <span className="ml-auto tabular-nums">{v.outputs.map((o) => `${o.good} ${o.unit.toLowerCase()} ${o.name}`).join(", ")} · cost {n2(v.totalCost)}</span>
        </summary>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-1 text-xs font-semibold">Source (Consumption)</h4>
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Item</th><th className="text-right font-medium">Used</th><th className="text-right font-medium">Expected</th><th className="text-right font-medium">Var %</th><th className="text-right font-medium">Rate</th><th className="text-right font-medium">Cost</th></tr></thead>
              <tbody>{v.inputs.map((i) => <tr key={i.ingredientId} className="border-t border-border"><td className="py-1">{i.name}{i.location ? ` · ${i.location}` : ""}{i.lot ? ` · lot ${i.lot}` : ""}{i.directTo ? ` · only ${i.directTo}` : ""}</td><td className="text-right tabular-nums">{i.quantity} {i.unit}</td><td className="text-right tabular-nums">{i.expected ?? "–"}</td><td className="text-right tabular-nums">{i.variancePercent ? `${sgn(i.variancePercent)}%` : "–"}</td><td className="text-right tabular-nums">{n2(i.rate)}</td><td className="text-right tabular-nums">{n2(i.cost)}</td></tr>)}</tbody></table>
            {v.additionalCosts.length > 0 && <ul className="mt-1 text-xs text-muted-foreground">{v.additionalCosts.map((c, i) => <li key={i}>{c.category}{c.included ? "" : " (not in cost)"}: {n2(c.amount)}</li>)}</ul>}
          </div>
          <div>
            <h4 className="mb-1 text-xs font-semibold">Destination (Production)</h4>
            <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 font-medium">Item</th><th className="text-right font-medium">Good</th><th className="text-right font-medium">Rejected</th><th className="text-right font-medium">Yield</th><th className="text-right font-medium">Allocated</th><th className="text-right font-medium">Per unit</th></tr></thead>
              <tbody>{v.outputs.map((o) => <tr key={o.ingredientId} className="border-t border-border"><td className="py-1">{o.name}{o.location ? ` · ${o.location}` : ""}{o.lot ? ` · lot ${o.lot}` : ""}</td><td className="text-right tabular-nums">{o.good} {o.unit}</td><td className="text-right tabular-nums">{Number(o.rejected) > 0 ? `${o.rejected} (${o.rejectRate}%)` : "–"}</td><td className="text-right tabular-nums">{o.yieldPercent ? `${o.yieldPercent}%` : "–"}</td><td className="text-right tabular-nums">{n2(o.allocatedCost)}{o.percent && v.allocationMethod ? ` (${Number(o.percent).toFixed(1)}%)` : ""}</td><td className="text-right font-semibold tabular-nums">{n2(o.unitCost)}</td></tr>)}</tbody></table>
            <p className="mt-1 text-xs text-muted-foreground">Materials {n2(v.ingredientCost)} + additional {n2(v.additionalCost)} = <b className="text-foreground">{n2(v.totalCost)}</b>{v.allocationMethod ? ` · split ${v.allocationMethod === "QUANTITY" ? "by quantity" : "by manual percent"}` : ""}.</p>
            {v.quality && <p className="text-xs text-muted-foreground">Quality: {v.quality.result}{v.quality.grade ? ` · ${v.quality.grade}` : ""}{v.quality.notes ? ` · ${v.quality.notes}` : ""}</p>}
            {v.notes && <p className="text-xs text-muted-foreground">Narration: {v.notes}</p>}
          </div>
        </div>
      </details>
    </li>
  );
}
