"use client";

import { useMemo, useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { type TableBoardRow, type TableState, useTableBoard } from "@/hooks/use-nfc";
import { formatCurrency } from "@/lib/format";

// Status colours follow one rule everywhere: grey = nothing happening, green = served and open, blue = kitchen working,
// orange = money expected, red = a person must look. Colour is never the only signal: every card also says the state in words.
const STATE: Record<TableState, { label: string; chip: string; edge: string }> = {
  CLOSED: { label: "Available", chip: "bg-muted text-muted-foreground", edge: "border-border" },
  ACCESS_VERIFIED: { label: "Guest tapped in", chip: "bg-muted text-foreground", edge: "border-dashed border-muted-foreground/50" },
  OPEN: { label: "Occupied", chip: "bg-green-600/15 text-green-700 dark:text-green-400", edge: "border-green-600/50" },
  ORDER_PROCESSING: { label: "With the kitchen", chip: "bg-blue-600/15 text-blue-700 dark:text-blue-400", edge: "border-blue-600/50" },
  PAYMENT_PENDING: { label: "Payment pending", chip: "bg-orange-500/15 text-orange-700 dark:text-orange-400", edge: "border-orange-500/60" },
  SETTLED: { label: "Paid", chip: "bg-green-600/10 text-green-700 dark:text-green-400", edge: "border-green-600/30" },
  ATTENTION_REQUIRED: { label: "Needs attention", chip: "bg-red-600/15 text-red-700 dark:text-red-400", edge: "border-red-600/60" },
};
const ORDER: TableState[] = ["ATTENTION_REQUIRED", "PAYMENT_PENDING", "ORDER_PROCESSING", "OPEN", "ACCESS_VERIFIED", "SETTLED", "CLOSED"];

function since(iso: string | null): string {
  if (!iso) return "–";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function TableCard({ t }: { t: TableBoardRow }) {
  const s = STATE[t.state];
  return (
    <Card className={`flex flex-col gap-2 border-2 p-4 ${s.edge}`} aria-label={`Table ${t.number}, ${s.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-foreground">{t.name ?? `Table ${t.number}`}</p>
          <p className="truncate text-xs text-muted-foreground">{t.floor} · seats {t.capacity}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${s.chip}`}>{s.label}</span>
      </div>
      {t.reasons.length > 0 && <p className="text-xs text-muted-foreground">{t.reasons[0]}{t.reasons.length > 1 ? ` (+${t.reasons.length - 1} more)` : ""}</p>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div><dt className="text-xs text-muted-foreground">Bill</dt><dd className="font-semibold tabular-nums">{t.orderCount ? formatCurrency(Number(t.billTotal)) : "–"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Orders</dt><dd className="font-semibold tabular-nums">{t.orderCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Seated</dt><dd>{since(t.sessionOpenedAt)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Last activity</dt><dd>{since(t.lastActivityAt)}</dd></div>
        {t.guestCount > 0 && <div><dt className="text-xs text-muted-foreground">Guests</dt><dd>{t.guestCount}</dd></div>}
        {t.openedVia === "NFC" && <div><dt className="text-xs text-muted-foreground">Opened by</dt><dd>Guest tap</dd></div>}
      </dl>
    </Card>
  );
}

export default function LiveTablesPage() {
  const { branchId } = useBranch();
  const { data, isLoading, isError, refetch } = useTableBoard(branchId);
  const [filter, setFilter] = useState<TableState | "ALL">("ALL");
  const [floor, setFloor] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"state" | "number" | "activity" | "bill">("state");

  const floors = useMemo(() => [...new Set((data?.tables ?? []).map((t) => t.floor))], [data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (data?.tables ?? []).filter((t) => (filter === "ALL" || t.state === filter) && (!floor || t.floor === floor) && (!term || `${t.number} ${t.name ?? ""}`.toLowerCase().includes(term)));
    const by = {
      state: (a: TableBoardRow, b2: TableBoardRow) => ORDER.indexOf(a.state) - ORDER.indexOf(b2.state) || a.number.localeCompare(b2.number, undefined, { numeric: true }),
      number: (a: TableBoardRow, b2: TableBoardRow) => a.number.localeCompare(b2.number, undefined, { numeric: true }),
      activity: (a: TableBoardRow, b2: TableBoardRow) => (b2.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
      bill: (a: TableBoardRow, b2: TableBoardRow) => Number(b2.billTotal) - Number(a.billTotal),
    }[sort];
    return [...list].sort(by);
  }, [data, filter, floor, q, sort]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Live tables</h1>
        <p className="text-sm text-muted-foreground">What every table is doing right now. Worked out by the server from orders, the kitchen and payments; it refreshes by itself.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : isError || !data ? (
        <Card className="p-6 text-sm"><p className="text-destructive">Could not load the table board.</p><button className="mt-2 underline" onClick={() => void refetch()}>Try again</button></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card className="p-3"><p className="text-xs text-muted-foreground">Active sessions</p><p className="text-2xl font-semibold tabular-nums">{data.activeSessions}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted-foreground">Open orders</p><p className="text-2xl font-semibold tabular-nums">{data.activeOrders}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted-foreground">Payment pending</p><p className="text-2xl font-semibold tabular-nums">{data.counts.PAYMENT_PENDING}</p></Card>
            <Card className="p-3"><p className="text-xs text-muted-foreground">Needs attention</p><p className="text-2xl font-semibold tabular-nums">{data.counts.ATTENTION_REQUIRED}</p></Card>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
            <button type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")} className={`h-10 rounded-full border px-3 text-sm ${filter === "ALL" ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>All ({data.tables.length})</button>
            {ORDER.map((s) => (
              <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)} className={`h-10 rounded-full border px-3 text-sm ${filter === s ? "border-primary bg-primary/10 font-semibold" : "border-border"}`}>{STATE[s].label} ({data.counts[s]})</button>
            ))}
          </div>

          <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1"><Label htmlFor="t-search">Search</Label><Input id="t-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Table number or name" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="t-floor">Floor</Label><select id="t-floor" className={selectClass} value={floor} onChange={(e) => setFloor(e.target.value)}><option value="">All floors</option>{floors.map((f) => <option key={f}>{f}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="t-sort">Sort by</Label><select id="t-sort" className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="state">Needs me first</option><option value="number">Table number</option><option value="activity">Latest activity</option><option value="bill">Biggest bill</option></select></div>
          </Card>

          {rows.length === 0 ? (
            <Card className="py-10 text-center text-sm text-muted-foreground">{data.tables.length === 0 ? "No tables yet. Add tables under Tables." : "No table matches these filters."}</Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rows.map((t) => <li key={t.id}><TableCard t={t} /></li>)}</ul>
          )}
        </>
      )}
    </div>
  );
}
