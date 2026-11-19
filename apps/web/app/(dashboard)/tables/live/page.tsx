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
  CLOSED: { label: "Available", chip: "bg-secondary text-muted-foreground border border-border/60", edge: "border-border/80" },
  ACCESS_VERIFIED: { label: "Guest tapped in", chip: "bg-secondary text-foreground border border-border/80", edge: "border-dashed border-muted-foreground/40" },
  OPEN: { label: "Occupied", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20", edge: "border-emerald-500/40" },
  ORDER_PROCESSING: { label: "With kitchen", chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/20", edge: "border-sky-500/40" },
  PAYMENT_PENDING: { label: "Payment pending", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20", edge: "border-amber-500/40" },
  SETTLED: { label: "Paid", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20", edge: "border-emerald-500/30" },
  ATTENTION_REQUIRED: { label: "Needs attention", chip: "bg-destructive/15 text-destructive border border-destructive/20", edge: "border-destructive/40" },
};
const ORDER: TableState[] = ["ATTENTION_REQUIRED", "PAYMENT_PENDING", "ORDER_PROCESSING", "OPEN", "ACCESS_VERIFIED", "SETTLED", "CLOSED"];

function since(iso: string | null): string {
  if (!iso) return "–";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function TableCard({ t }: { t: TableBoardRow }) {
  const s = STATE[t.state];
  return (
    <Card className={`flex flex-col justify-between gap-3 border p-3.5 sm:p-4 rounded-2xl bg-card shadow-xs transition-all hover:shadow-sm ${s.edge}`} aria-label={`Table ${t.number}, ${s.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base sm:text-lg font-bold text-foreground">{t.name ?? `Table ${t.number}`}</p>
          <p className="truncate text-xs text-muted-foreground">{t.floor} · {t.capacity} seats</p>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold tracking-tight ${s.chip}`}>{s.label}</span>
      </div>
      {t.reasons.length > 0 && (
        <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-2 py-1 line-clamp-1">
          {t.reasons[0]}{t.reasons.length > 1 ? ` (+${t.reasons.length - 1} more)` : ""}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs border-t border-border/50 pt-2.5">
        <div><dt className="text-[11px] text-muted-foreground font-medium">Bill</dt><dd className="font-bold tabular-nums text-foreground">{t.orderCount ? formatCurrency(Number(t.billTotal)) : "–"}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground font-medium">Orders</dt><dd className="font-semibold tabular-nums text-foreground">{t.orderCount}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground font-medium">Seated</dt><dd className="text-muted-foreground font-medium">{since(t.sessionOpenedAt)}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground font-medium">Last active</dt><dd className="text-muted-foreground font-medium">{since(t.lastActivityAt)}</dd></div>
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
    <div className="flex flex-col gap-4 sm:gap-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Live tables</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Real-time status, active orders, and payments across all floors</p>
      </div>

      {isLoading ? (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : isError || !data ? (
        <Card className="p-6 text-sm"><p className="text-destructive font-medium">Could not load the table board.</p><button className="mt-2 text-primary font-semibold underline" onClick={() => void refetch()}>Try again</button></Card>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <Card className="p-3 sm:p-4 rounded-xl border border-border/80 bg-card shadow-xs">
              <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active sessions</p>
              <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-foreground">{data.activeSessions}</p>
            </Card>
            <Card className="p-3 sm:p-4 rounded-xl border border-border/80 bg-card shadow-xs">
              <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Open orders</p>
              <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-foreground">{data.activeOrders}</p>
            </Card>
            <Card className="p-3 sm:p-4 rounded-xl border border-border/80 bg-card shadow-xs">
              <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment pending</p>
              <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-warning">{data.counts.PAYMENT_PENDING}</p>
            </Card>
            <Card className="p-3 sm:p-4 rounded-xl border border-border/80 bg-card shadow-xs">
              <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">Needs attention</p>
              <p className="mt-1 text-xl sm:text-2xl font-bold tabular-nums text-destructive">{data.counts.ATTENTION_REQUIRED}</p>
            </Card>
          </div>

          {/* Filter Pills: Horizontal scroll on mobile */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1" role="group" aria-label="Filter by state">
            <button
              type="button"
              aria-pressed={filter === "ALL"}
              onClick={() => setFilter("ALL")}
              className={`shrink-0 h-8 rounded-xl px-3 text-xs font-semibold transition-all active:scale-95 ${
                filter === "ALL"
                  ? "bg-primary text-white shadow-xs"
                  : "border border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              All ({data.tables.length})
            </button>
            {ORDER.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
                className={`shrink-0 h-8 rounded-xl px-3 text-xs font-medium transition-all active:scale-95 ${
                  filter === s
                    ? "bg-primary text-white font-semibold shadow-xs"
                    : "border border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {STATE[s].label} ({data.counts[s]})
              </button>
            ))}
          </div>

          {/* Filter Bar */}
          <Card className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl border border-border/80 bg-card shadow-xs">
            <div className="flex flex-col gap-1">
              <Label htmlFor="t-search" className="text-xs font-semibold">Search</Label>
              <Input id="t-search" type="search" className="h-9 rounded-lg text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Table number or name" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="t-floor" className="text-xs font-semibold">Floor</Label>
              <select id="t-floor" className={`${selectClass} text-xs`} value={floor} onChange={(e) => setFloor(e.target.value)}>
                <option value="">All floors</option>
                {floors.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="t-sort" className="text-xs font-semibold">Sort by</Label>
              <select id="t-sort" className={`${selectClass} text-xs`} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                <option value="state">Needs me first</option>
                <option value="number">Table number</option>
                <option value="activity">Latest activity</option>
                <option value="bill">Biggest bill</option>
              </select>
            </div>
          </Card>

          {rows.length === 0 ? (
            <Card className="py-16 text-center text-sm text-muted-foreground rounded-2xl border border-border/80">
              {data.tables.length === 0 ? "No tables configured yet." : "No tables match these filters."}
            </Card>
          ) : (
            <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.map((t) => <li key={t.id}><TableCard t={t} /></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
