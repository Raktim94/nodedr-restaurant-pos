"use client";

import { useMemo, useState } from "react";
import { 
  Building2, 
  Calendar, 
  CheckCircle2, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  Filter, 
  Layers, 
  MapPin, 
  Package, 
  TrendingDown, 
  TrendingUp 
} from "lucide-react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { csvUrl, useStockItems, useStockSummary } from "@/hooks/use-stock-journal";
import { cn } from "@/lib/utils";

const first = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const n = (v: string) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
const signed = (v: string) => (Number(v) > 0 ? "+" : "") + n(v);

const nativeSelectClass =
  "h-11 sm:h-9 w-full rounded-xl border border-input bg-background px-3 text-xs sm:text-sm font-medium text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function StockReportPage() {
  const { branchId } = useBranch();
  const [from, setFrom] = useState(first());
  const [to, setTo] = useState(today());
  const [ingredientId, setIngredientId] = useState("");
  const [kind, setKind] = useState("");
  const [location, setLocation] = useState("");
  const filters = {
    ingredientId,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const { data: items } = useStockItems(branchId);
  const { data, isLoading, isError } = useStockSummary(branchId, filters);
  const locations = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.location).filter(Boolean))] as string[], [data]);
  const rows = (data?.rows ?? []).filter((r) => (!kind || r.kind === kind) && (!location || r.location === location));

  const totalSKUs = rows.length;
  const netAdditions = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.receipts) || 0) + (Number(r.manufacturingProduced) || 0), 0), [rows]);
  const netDepletions = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.sales) || 0) + (Number(r.waste) || 0) + (Number(r.manufacturingUsed) || 0), 0), [rows]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 pb-24 sm:pb-20">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
              Stock Balance Report
            </h1>
            <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground border-border/70">
              Valuation & Turn
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Full reconciliation equation: Opening + Purchases + Production = Sales + Waste + Closing
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            className="flex items-center justify-center gap-1.5 h-11 sm:h-9 px-4 rounded-xl border border-border/80 bg-secondary/50 hover:bg-secondary text-xs font-semibold text-foreground active:scale-98 transition-all"
            href={csvUrl("journal/summary.csv", branchId, filters)}
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      <InventoryTabs />

      {/* KPI Overview */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 sm:p-4 shadow-2xs">
          <span className="text-[11px] sm:text-xs font-medium text-muted-foreground line-clamp-1">Tracked Items</span>
          <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums my-1">
            {totalSKUs}
          </span>
          <span className="text-[10px] sm:text-[11px] text-muted-foreground line-clamp-1">In selected range</span>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 sm:p-4 shadow-2xs">
          <span className="text-[11px] sm:text-xs font-medium text-muted-foreground line-clamp-1">Added / Inflow</span>
          <span className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-600 tabular-nums my-1">
            +{n(String(netAdditions))}
          </span>
          <span className="text-[10px] sm:text-[11px] text-muted-foreground line-clamp-1">Receipts & Mfg</span>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 sm:p-4 shadow-2xs">
          <span className="text-[11px] sm:text-xs font-medium text-muted-foreground line-clamp-1">Depleted / Outflow</span>
          <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums my-1">
            {n(String(netDepletions))}
          </span>
          <span className="text-[10px] sm:text-[11px] text-muted-foreground line-clamp-1">Sales, Prep & Waste</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 rounded-2xl border border-border/80 bg-card p-3 sm:p-4 shadow-2xs">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-from" className="text-xs font-semibold">From Date</Label>
          <Input
            id="s-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-to" className="text-xs font-semibold">To Date</Label>
          <Input
            id="s-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-item" className="text-xs font-semibold">Ingredient</Label>
          <select
            id="s-item"
            className={nativeSelectClass}
            value={ingredientId}
            onChange={(e) => setIngredientId(e.target.value)}
          >
            <option value="">All items</option>
            {(items ?? []).map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-kind" className="text-xs font-semibold">Category Type</Label>
          <select
            id="s-kind"
            className={nativeSelectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">Raw and finished</option>
            <option value="PURCHASED">Raw materials</option>
            <option value="PREPARED">Finished products</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="s-loc" className="text-xs font-semibold">Storage Location</Label>
          <select
            id="s-loc"
            className={nativeSelectClass}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((l) => (<option key={l}>{l}</option>))}
          </select>
        </div>
      </div>

      {/* Main Table & Mobile Cards */}
      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <Card className="p-8 text-center text-sm text-destructive rounded-2xl border-dashed">
          Could not load the stock report.
        </Card>
      ) : rows.length ? (
        <>
          {/* Desktop Table View (>= md) */}
          <div className="hidden md:block rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/80 text-xs">
                  <TableHead className="font-semibold text-foreground py-3">Item</TableHead>
                  <TableHead className="font-semibold text-foreground py-3">Location</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Opening</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Purchases (+)</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Mfg Used (-)</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Mfg Made (+)</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Sales (-)</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Waste (-)</TableHead>
                  <TableHead className="text-right font-semibold text-foreground py-3">Adjustments</TableHead>
                  <TableHead className="text-right font-bold text-foreground py-3">Closing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.ingredientId}-${r.location}`} className="hover:bg-muted/30">
                    <TableCell className="py-3 font-semibold text-xs text-foreground">
                      <span>{r.name}</span>
                      <span className="text-[11px] font-normal text-muted-foreground ml-1">({r.unit})</span>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
                      {r.location || <span className="text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-muted-foreground">
                      {n(r.opening)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-emerald-600 font-medium">
                      {signed(r.receipts)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-muted-foreground">
                      {signed(r.manufacturingUsed)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-primary font-medium">
                      {signed(r.manufacturingProduced)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-muted-foreground">
                      {signed(r.sales)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-destructive">
                      {signed(r.waste)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums text-xs text-muted-foreground">
                      {signed(r.adjustments)}
                    </TableCell>
                    <TableCell className="py-3 text-right tabular-nums font-bold text-xs text-foreground">
                      {n(r.closing)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card View (< md) with Apple HIG touch-first styling */}
          <div className="md:hidden flex flex-col gap-2.5">
            {rows.map((r) => (
              <div
                key={`${r.ingredientId}-${r.location}`}
                className="flex flex-col gap-2.5 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs active:bg-secondary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-bold text-sm text-foreground">{r.name}</span>
                    <span className="text-[11px] text-muted-foreground mt-0.5">
                      Location: <strong className="text-foreground font-medium">{r.location || "Default Store"}</strong>
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Closing</span>
                    <span className="font-bold text-base tabular-nums text-foreground">
                      {n(r.closing)} {r.unit}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50 text-xs">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground">Opening</span>
                    <span className="font-medium tabular-nums text-foreground">{n(r.opening)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground">In (Rec/Mfg)</span>
                    <span className="font-semibold tabular-nums text-emerald-600">
                      {signed(String((Number(r.receipts) || 0) + (Number(r.manufacturingProduced) || 0)))}
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] text-muted-foreground">Out (Sale/Waste)</span>
                    <span className="font-semibold tabular-nums text-destructive">
                      {signed(String((Number(r.sales) || 0) + (Number(r.waste) || 0) + (Number(r.manufacturingUsed) || 0)))}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-2xl border-dashed bg-card/60">
          <Layers className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-semibold text-foreground">No Stock Movement Data</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            There were no opening or closing movements for this filter period.
          </p>
        </Card>
      )}
    </div>
  );
}
