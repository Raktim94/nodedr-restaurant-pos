"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { 
  AlertTriangle, 
  ArrowRight, 
  CalendarClock, 
  CheckCircle2, 
  Clock, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  MapPin, 
  Package, 
  Plus, 
  Printer, 
  Search, 
  ShoppingCart, 
  Sparkles, 
  Truck 
} from "lucide-react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { csvUrl, useExpiring, useReorder } from "@/hooks/use-stock-journal";
import { cn } from "@/lib/utils";

export default function ShoppingListPage() {
  const { branchId } = useBranch();
  const { data: list, isLoading, isError } = useReorder(branchId);
  const { data: expiring, isLoading: isExpiringLoading } = useExpiring(branchId, 7);

  const [search, setSearch] = useState("");

  const filteredList = useMemo(() => {
    if (!list) return [];
    if (!search.trim()) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.category && r.category.toLowerCase().includes(search.toLowerCase())) ||
        (r.storageLocation && r.storageLocation.toLowerCase().includes(search.toLowerCase()))
    );
  }, [list, search]);

  const byCat = useMemo(() => {
    const map = new Map<string, typeof filteredList>();
    for (const r of filteredList) {
      const c = r.category || "General Groceries";
      map.set(c, [...(map.get(c) ?? []), r]);
    }
    return map;
  }, [filteredList]);

  const totalItemsToBuy = list?.length ?? 0;
  const criticalItems = (list ?? []).filter((r) => Number(r.inStock) <= 0).length;
  const expiringCount = expiring?.length ?? 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-20">
      {/* Page Title & Export Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Shopping List & Restock
            </h1>
            <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground border-border/70">
              Procurement Reorder
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Auto-calculated restock quantities based on minimum thresholds and batch expiry dates
          </p>
        </div>

        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 print:hidden">
          <Link
            href="/inventory/purchase-orders"
            className="col-span-2 sm:col-auto inline-flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs active:scale-98 transition-transform whitespace-nowrap"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>Create Purchase Order</span>
          </Link>

          <a
            className="inline-flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-xs font-medium text-foreground hover:bg-secondary active:scale-98 transition-transform whitespace-nowrap"
            href={csvUrl("journal/reorder.csv", branchId)}
            download
          >
            <Download className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>Export CSV</span>
          </a>

          <button
            type="button"
            className="inline-flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-xs font-medium text-foreground hover:bg-secondary active:scale-98 transition-transform whitespace-nowrap"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>Print</span>
          </button>
        </div>
      </div>

      <div className="print:hidden">
        <InventoryTabs />
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 print:hidden">
        {/* Total to buy */}
        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">Items to Restock</span>
            <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums mt-1">
              {totalItemsToBuy}
            </span>
            <span className="text-[11px] text-muted-foreground mt-0.5">At or below reorder level</span>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShoppingCart className="h-5 w-5" />
          </div>
        </div>

        {/* Completely Out */}
        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">Critical Depletions</span>
            <span className={cn("text-2xl font-bold tracking-tight tabular-nums mt-1", criticalItems > 0 ? "text-destructive" : "text-foreground")}>
              {criticalItems}
            </span>
            <span className="text-[11px] text-muted-foreground mt-0.5">Zero physical quantity</span>
          </div>
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", criticalItems > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card p-3.5 sm:p-4 shadow-2xs">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">Expiring (7 Days)</span>
            <span className={cn("text-2xl font-bold tracking-tight tabular-nums mt-1", expiringCount > 0 ? "text-amber-500" : "text-foreground")}>
              {expiringCount}
            </span>
            <span className="text-[11px] text-muted-foreground mt-0.5">Batches needing priority use</span>
          </div>
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", expiringCount > 0 ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground")}>
            <CalendarClock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Section: Expiring Soon (First Priority Usage) */}
      <section aria-label="Expiring soon" id="expiring" className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Use These First — Expiring in 7 Days
          </h2>
        </div>

        {isExpiringLoading ? (
          <Skeleton className="h-24 rounded-2xl" />
        ) : expiring && expiring.length > 0 ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-1 overflow-hidden shadow-2xs">
            <ul className="divide-y divide-amber-500/20 text-xs sm:text-sm">
              {expiring.map((e) => (
                <li key={e.batchId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 sm:px-4 hover:bg-amber-500/10 transition-colors">
                  <div className="flex flex-col">
                    <span className="font-semibold text-foreground text-sm">{e.name}</span>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                      {e.storageLocation && (
                        <>
                          <MapPin className="h-3 w-3" />
                          <span>{e.storageLocation}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-bold tabular-nums text-foreground">
                      {e.quantity} {e.unit}
                    </span>
                    <Badge
                      variant={e.expired || e.daysLeft <= 1 ? "destructive" : "outline"}
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5",
                        !e.expired && e.daysLeft > 1 && "border-amber-500 text-amber-600 bg-amber-500/10"
                      )}
                    >
                      {e.expired ? "Expired" : e.daysLeft <= 0 ? "Expires Today" : `${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"} left`}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/80 bg-card p-4 text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>No incoming stock batches are expiring within the next 7 days.</span>
          </div>
        )}
      </section>

      {/* Section: To Buy & Restock */}
      <section aria-label="To buy" className="flex flex-col gap-3 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Required Restock Items
            </h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {filteredList.length} items
            </span>
          </div>

          {/* Search Bar for Restock List */}
          {list && list.length > 0 && (
            <div className="relative w-full sm:max-w-xs print:hidden">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search shopping list…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8.5 text-xs rounded-xl bg-card"
              />
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : isError ? (
          <Card className="p-8 text-center text-sm text-destructive rounded-2xl border-dashed">
            Could not load the restock list. Please check your connection.
          </Card>
        ) : filteredList.length > 0 ? (
          <div className="flex flex-col gap-4">
            {[...byCat.entries()].map(([cat, rows]) => (
              <div key={cat} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {cat}
                  </span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>

                <div className="rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs divide-y divide-border/60">
                  {rows.map((r) => {
                    const isOut = Number(r.inStock) <= 0;
                    return (
                      <div
                        key={r.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 sm:px-4 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground">{r.name}</span>
                            {isOut && (
                              <Badge variant="destructive" className="text-[10px] py-0">
                                Out of stock
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span>
                              Current: <strong className="font-medium text-foreground">{r.inStock} {r.unit}</strong>
                            </span>
                            <span>•</span>
                            <span>Min threshold: {r.minimum} {r.unit}</span>
                            <span>•</span>
                            <span>Order up to: {r.par} {r.unit}</span>
                            {r.storageLocation && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {r.storageLocation}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Order Quantity Pill */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0 border-t border-border/40 sm:border-0">
                          <span className="text-xs text-muted-foreground sm:hidden">Suggested Order:</span>
                          <div className="flex items-center gap-2 rounded-xl bg-primary/10 text-primary font-bold px-3 py-1.5 text-sm tabular-nums shadow-2xs">
                            <span>+ {r.toBuy}</span>
                            <span className="text-xs font-normal">{r.unit}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Empty State: Everything Well-Stocked */
          <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-2xl border-dashed bg-card/60">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-1 max-w-sm">
              <h3 className="text-base font-semibold text-foreground">All Stock Levels are Healthy</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {search
                  ? `No items match "${search}". Clear your filter to view other categories.`
                  : "Every item is currently above its minimum reorder threshold. No immediate restock is required."}
              </p>
            </div>
            <Link
              href="/inventory"
              className="mt-1 text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              <span>View all inventory items</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        )}
      </section>
    </div>
  );
}
