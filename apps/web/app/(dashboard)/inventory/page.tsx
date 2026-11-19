"use client";

import { 
  AlertTriangle, 
  ArrowUpDown, 
  Boxes, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  Layers, 
  Package, 
  Search, 
  Sparkles, 
  SlidersHorizontal,
  X,
  UploadCloud,
  Plus
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useMemo } from "react";
import { ImportCsvDialog } from "@/components/imports/import-csv-dialog";
import { AddIngredientDialog } from "@/components/inventory/add-ingredient-dialog";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients, useTrackingStatus, type Ingredient } from "@/hooks/use-inventory";
import { useExpiring } from "@/hooks/use-stock-journal";
import { rank, STOCK_CATEGORIES, STORAGE_AREAS } from "@/lib/restaurant-stock";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

function InventoryView() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canImport = hasPermission(me?.user, "inventory.manage");
  const [search, setSearch] = useState("");
  const params = useSearchParams();
  const router = useRouter();

  const [view, setView] = useState<"all" | "raw" | "made" | "low" | "out">(() => 
    params.get("filter") === "low" ? "low" : "all"
  );
  const [area, setArea] = useState("");
  const [showValue, setShowValue] = useState(false);

  const { data: ingredients, isLoading } = useIngredients(branchId);
  const { data: trackingStatus } = useTrackingStatus(branchId);
  const { data: expiring } = useExpiring(branchId, 3);

  const isOut = (i: { currentStock: string }) => Number(i.currentStock) <= 0;
  const isLowish = (i: { currentStock: string; reorderLevel: string }) => 
    !isOut(i) && Number(i.reorderLevel) > 0 && Number(i.currentStock) <= Number(i.reorderLevel);

  const active = useMemo(() => (ingredients ?? []).filter((i) => i.isActive !== false), [ingredients]);
  const lowCount = useMemo(() => active.filter(isLowish).length, [active]);
  const outCount = useMemo(() => active.filter((i) => isOut(i) && i.kind !== "PREPARED").length, [active]);
  const totalItemsCount = active.length;

  const totalStockValuation = useMemo(() => {
    return active.reduce((sum, item) => {
      const stock = Number(item.currentStock) || 0;
      const cost = Number(item.costPerUnit) || 0;
      return sum + (stock > 0 ? stock * cost : 0);
    }, 0);
  }, [active]);

  const areas = useMemo(() => {
    return [...new Set(active.map((i) => i.storageLocation).filter((x): x is string => !!x))].sort(
      (a, b) => rank(STORAGE_AREAS, a) - rank(STORAGE_AREAS, b) || a.localeCompare(b)
    );
  }, [active]);

  const filtered = useMemo(() => {
    return active.filter((i) => {
      const matchesSearch = !search.trim() || 
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.sku && i.sku.toLowerCase().includes(search.toLowerCase())) ||
        (i.category && i.category.toLowerCase().includes(search.toLowerCase()));

      const matchesArea = !area || i.storageLocation === area;

      const matchesView =
        view === "all" ||
        (view === "raw" && i.kind !== "PREPARED") ||
        (view === "made" && i.kind === "PREPARED") ||
        (view === "low" && (isLowish(i) || (isOut(i) && Number(i.reorderLevel) > 0))) ||
        (view === "out" && isOut(i) && i.kind !== "PREPARED");

      return matchesSearch && matchesArea && matchesView;
    });
  }, [active, search, area, view]);

  const byCat = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const i of filtered) {
      const c = i.kind === "PREPARED" ? "Kitchen Prepared Items" : i.category || "General Groceries";
      map.set(c, [...(map.get(c) ?? []), i]);
    }
    return map;
  }, [filtered]);

  const groups = useMemo(() => {
    return [...byCat.entries()].sort(([a], [b]) => 
      a === "Kitchen Prepared Items" 
        ? 1 
        : b === "Kitchen Prepared Items" 
        ? -1 
        : rank(STOCK_CATEGORIES, a) - rank(STOCK_CATEGORIES, b) || a.localeCompare(b)
    );
  }, [byCat]);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 pb-24 sm:pb-20">
      {/* Page Title & Action Header: responsive touch-first actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight text-foreground">
              Inventory & Supply
            </h1>
            <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground border-border/70">
              Live Stock
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Manage ingredient levels, recipes, procurement orders, and kitchen preparation
          </p>
        </div>

        {/* Action Buttons: 44pt mobile touch targets with tactile feedback */}
        <div className="flex items-center gap-2">
          {canImport && (
            <div className="flex-1 sm:flex-initial [&>button]:w-full [&>button]:h-11 sm:[&>button]:h-9 [&>button]:rounded-xl [&>button]:active:scale-98">
              <ImportCsvDialog kind="ingredients" branchId={branchId} />
            </div>
          )}
          <div className="flex-1 sm:flex-initial [&>button]:w-full [&>button]:h-11 sm:[&>button]:h-9 [&>button]:rounded-xl [&>button]:active:scale-98 font-semibold">
            <AddIngredientDialog branchId={branchId} />
          </div>
        </div>
      </div>

      <InventoryTabs />

      {/* Critical Stock Recipe Warning */}
      {trackingStatus && trackingStatus.problems.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-3.5 sm:p-4 text-sm shadow-2xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex flex-col gap-0.5 text-xs sm:text-sm">
            <p className="font-semibold text-foreground">
              {trackingStatus.problems.length} menu item{trackingStatus.problems.length === 1 ? "" : "s"} missing stock links
            </p>
            <p className="text-muted-foreground leading-relaxed">
              These will deduct nothing when billed. Configure via Menu → Edit item → Stock when sold:{" "}
              <span className="font-medium text-foreground">{trackingStatus.problems.map((p) => p.name).join(", ")}</span>
            </p>
          </div>
        </div>
      )}

      {/* Apple-styled KPI Overview: Compact 4-col grid that adapts on mobile without excessive height */}
      <section aria-label="Key stock metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* Total Stock / Valuation Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 sm:p-4 shadow-2xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] sm:text-xs font-medium">Stock Value</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex flex-col">
            <span className="text-lg sm:text-2xl font-bold tracking-tight text-foreground tabular-nums truncate">
              {formatCurrency(totalStockValuation)}
            </span>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5">
              Across <strong className="font-medium text-foreground">{totalItemsCount}</strong> active SKUs
            </span>
          </div>
        </div>

        {/* Low Stock Filter Card */}
        <button
          type="button"
          aria-pressed={view === "low"}
          onClick={() => setView(view === "low" ? "all" : "low")}
          className={cn(
            "flex flex-col justify-between rounded-2xl border p-3 sm:p-4 text-left shadow-2xs transition-all active:scale-[0.98]",
            view === "low"
              ? "border-warning bg-warning/10 ring-1 ring-warning"
              : "border-border/80 bg-card hover:border-warning/50 hover:bg-warning/[0.02]"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-muted-foreground">Running Low</span>
            <div className={cn("flex h-7 w-7 items-center justify-center rounded-xl", lowCount > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex flex-col">
            <span className={cn("text-lg sm:text-2xl font-bold tracking-tight tabular-nums", lowCount > 0 ? "text-warning" : "text-foreground")}>
              {lowCount}
            </span>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5">
              At or below minimum
            </span>
          </div>
        </button>

        {/* Out of Stock Filter Card */}
        <button
          type="button"
          aria-pressed={view === "out"}
          onClick={() => setView(view === "out" ? "all" : "out")}
          className={cn(
            "flex flex-col justify-between rounded-2xl border p-3 sm:p-4 text-left shadow-2xs transition-all active:scale-[0.98]",
            view === "out"
              ? "border-destructive bg-destructive/10 ring-1 ring-destructive"
              : "border-border/80 bg-card hover:border-destructive/50 hover:bg-destructive/[0.02]"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-muted-foreground">Out of Stock</span>
            <div className={cn("flex h-7 w-7 items-center justify-center rounded-xl", outCount > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>
              <Package className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex flex-col">
            <span className={cn("text-lg sm:text-2xl font-bold tracking-tight tabular-nums", outCount > 0 ? "text-destructive" : "text-foreground")}>
              {outCount}
            </span>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5">
              Zero quantity items
            </span>
          </div>
        </button>

        {/* Expiring Soon Card */}
        <button
          type="button"
          onClick={() => router.push("/inventory/shopping-list#expiring")}
          className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 sm:p-4 text-left shadow-2xs transition-all hover:border-border hover:bg-secondary/40 active:scale-[0.98]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] sm:text-xs font-medium text-muted-foreground">Expiring (3 Days)</span>
            <div className={cn("flex h-7 w-7 items-center justify-center rounded-xl", (expiring?.length ?? 0) > 0 ? "bg-amber-500/15 text-amber-500" : "bg-muted text-muted-foreground")}>
              <Clock className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-1 sm:mt-2 flex flex-col">
            <span className={cn("text-lg sm:text-2xl font-bold tracking-tight tabular-nums", (expiring?.length ?? 0) > 0 ? "text-amber-500" : "text-foreground")}>
              {expiring?.length ?? 0}
            </span>
            <span className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5">
              Batches near expiry
            </span>
          </div>
        </button>
      </section>

      {/* Unified Filter & Search Toolbar with iOS Segmented Control */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 sm:p-3.5 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* Search Input: 44pt mobile target */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search items by name, SKU, or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-11 sm:h-9 text-xs sm:text-sm bg-background rounded-xl border-border/70"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* iOS Segmented Control for Quick Filter Tabs */}
          <div className="flex items-center p-1 bg-muted/60 rounded-xl border border-border/60 overflow-x-auto scrollbar-none">
            {([
              ["all", "All"],
              ["raw", "Raw Materials"],
              ["made", "Kitchen Made"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={view === k}
                onClick={() => setView(k)}
                className={cn(
                  "flex-1 sm:flex-initial min-h-[36px] sm:min-h-[30px] px-3.5 py-1 text-xs font-semibold rounded-lg transition-all text-center whitespace-nowrap active:scale-96",
                  view === k
                    ? "bg-background text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Toggle Valuation Switch */}
          <div className="flex items-center justify-between sm:justify-start gap-2 pt-1 sm:pt-0">
            <label htmlFor="show-valuation" className="text-xs font-medium text-muted-foreground cursor-pointer select-none">
              Valuation
            </label>
            <Switch
              id="show-valuation"
              size="sm"
              checked={showValue}
              onCheckedChange={setShowValue}
            />
          </div>
        </div>

        {/* Secondary: Storage Area Pills */}
        {areas.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-2 border-t border-border/50">
            <span className="text-[11px] font-semibold text-muted-foreground shrink-0 pr-1">Area:</span>
            <button
              type="button"
              aria-pressed={!area}
              onClick={() => setArea("")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 active:scale-96",
                !area
                  ? "bg-secondary text-foreground font-semibold border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              All Locations
            </button>
            {areas.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={area === a}
                onClick={() => setArea(area === a ? "" : a)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-all shrink-0 active:scale-96",
                  area === a
                    ? "bg-secondary text-foreground font-semibold border border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content: Stock Items Table / Cards */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : groups.length > 0 ? (
        <div className="flex flex-col gap-6">
          {groups.map(([cat, rows]) => (
            <section key={cat} aria-label={cat} className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-foreground">{cat}</h2>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "item" : "items"}
                  </span>
                </div>
              </div>

              {/* Desktop & Tablet Table (Hidden on Mobile) */}
              <div className="hidden md:block rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/80">
                      <TableHead className="font-semibold text-xs text-foreground py-3">Item & Details</TableHead>
                      <TableHead className="text-right font-semibold text-xs text-foreground py-3">In Stock</TableHead>
                      <TableHead className="text-right font-semibold text-xs text-foreground py-3">Minimum</TableHead>
                      <TableHead className="w-40 font-semibold text-xs text-foreground py-3">Stock Health</TableHead>
                      {showValue && (
                        <>
                          <TableHead className="text-right font-semibold text-xs text-foreground py-3">Avg Cost</TableHead>
                          <TableHead className="text-right font-semibold text-xs text-foreground py-3">Total Value</TableHead>
                        </>
                      )}
                      <TableHead className="w-24 text-right font-semibold text-xs text-foreground py-3">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((i) => {
                      const stockNum = Number(i.currentStock);
                      const reorderNum = Number(i.reorderLevel) || 0;
                      const out = stockNum <= 0;
                      const low = !out && reorderNum > 0 && stockNum <= reorderNum;
                      
                      const baseTarget = reorderNum > 0 ? reorderNum * 2 : 10;
                      const percent = Math.min(Math.round((stockNum / baseTarget) * 100), 100);

                      return (
                        <TableRow key={i.id} className="transition-colors hover:bg-muted/30">
                          {/* Item Identity */}
                          <TableCell className="py-3">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground text-sm">{i.name}</span>
                                {i.kind === "PREPARED" && (
                                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                                    Prepared
                                  </Badge>
                                )}
                                {out ? (
                                  <Badge variant="destructive" className="gap-1 text-[10px] py-0">
                                    <AlertTriangle className="h-2.5 w-2.5" /> Out
                                  </Badge>
                                ) : low ? (
                                  <Badge variant="outline" className="gap-1 text-[10px] py-0 border-warning text-warning bg-warning/5">
                                    <AlertTriangle className="h-2.5 w-2.5" /> Low
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {i.sku && <span className="font-mono text-[11px]">SKU: {i.sku}</span>}
                                {i.sku && i.storageLocation && <span>•</span>}
                                {i.storageLocation && <span>{i.storageLocation}</span>}
                              </div>
                            </div>
                          </TableCell>

                          {/* Current Stock */}
                          <TableCell className="text-right tabular-nums py-3">
                            <span className={cn("font-bold text-sm", out ? "text-destructive" : low ? "text-warning" : "text-foreground")}>
                              {i.currentStock}
                            </span>
                            <span className="text-xs text-muted-foreground ml-1">{i.unit}</span>
                          </TableCell>

                          {/* Minimum Stock */}
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground py-3">
                            {i.reorderLevel} {i.unit}
                          </TableCell>

                          {/* Health Bar Visualizer */}
                          <TableCell className="py-3">
                            <div className="flex flex-col gap-1 w-32">
                              <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    out ? "w-0" : low ? "bg-warning" : "bg-emerald-500"
                                  )}
                                  style={{ width: `${Math.max(percent, out ? 0 : 8)}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                {out ? "Depleted" : low ? "Below Minimum" : "Adequate"}
                              </span>
                            </div>
                          </TableCell>

                          {/* Purchase Values (Conditional) */}
                          {showValue && (
                            <>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground py-3">
                                {formatCurrency(i.costPerUnit)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs font-semibold text-foreground py-3">
                                {formatCurrency(stockNum * (Number(i.costPerUnit) || 0))}
                              </TableCell>
                            </>
                          )}

                          {/* Action Button */}
                          <TableCell className="text-right py-3">
                            <AdjustStockDialog branchId={branchId} ingredient={i} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View (< md screens) */}
              <div className="md:hidden flex flex-col gap-3">
                {rows.map((i) => {
                  const stockNum = Number(i.currentStock);
                  const reorderNum = Number(i.reorderLevel) || 0;
                  const out = stockNum <= 0;
                  const low = !out && reorderNum > 0 && stockNum <= reorderNum;

                  return (
                    <div
                      key={i.id}
                      className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-2xs active:bg-secondary/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="font-bold text-base text-foreground">{i.name}</span>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            {i.storageLocation && <span>{i.storageLocation}</span>}
                            {i.storageLocation && i.sku && <span>•</span>}
                            {i.sku && <span className="font-mono text-[10px]">SKU: {i.sku}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {out ? (
                            <Badge variant="destructive" className="gap-1 text-[10px] py-0.5 px-2">
                              Out
                            </Badge>
                          ) : low ? (
                            <Badge variant="outline" className="gap-1 text-[10px] py-0.5 px-2 border-warning text-warning bg-warning/5">
                              Low
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] py-0.5 px-2 text-emerald-600 bg-emerald-500/10 border-emerald-500/20">
                              Good
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3 text-xs">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">In Stock</span>
                          <span className={cn("text-base font-bold tabular-nums", out ? "text-destructive" : low ? "text-warning" : "text-foreground")}>
                            {i.currentStock} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span>
                          </span>
                        </div>

                        <div className="flex flex-col text-right sm:text-left">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Minimum</span>
                          <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                            {i.reorderLevel} <span className="text-xs font-normal">{i.unit}</span>
                          </span>
                        </div>

                        {showValue && (
                          <div className="col-span-2 sm:col-span-1 flex flex-col pt-2 sm:pt-0 border-t sm:border-t-0 sm:border-l border-border/60 text-left sm:text-right sm:pl-2">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Value</span>
                            <span className="text-sm font-bold tabular-nums text-foreground">
                              {formatCurrency(stockNum * (Number(i.costPerUnit) || 0))}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        {i.kind === "PREPARED" ? (
                          <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                            Kitchen Made
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Raw Material</span>
                        )}
                        <div className="[&>button]:h-9 [&>button]:px-3.5 [&>button]:rounded-xl [&>button]:text-xs [&>button]:font-medium [&>button]:active:scale-96">
                          <AdjustStockDialog branchId={branchId} ingredient={i} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center gap-2.5 py-16 text-center rounded-2xl border-dashed">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Package className="h-6 w-6" />
          </div>
          <p className="text-base font-semibold text-foreground">
            {ingredients && ingredients.length ? "No matching stock items" : "No stock items yet"}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-sm">
            {ingredients && ingredients.length
              ? "Try adjusting your search criteria or clear your current filters to view all ingredients."
              : "Add your raw ingredients or prepared dishes to start tracking inventory and recipes."}
          </p>
        </Card>
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <InventoryView />
    </Suspense>
  );
}
