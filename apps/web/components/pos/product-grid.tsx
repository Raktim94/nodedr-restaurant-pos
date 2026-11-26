"use client";

import { useState } from "react";
import { PauseBadge } from "@/components/menu/pause-badge";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMenuCosts, useMfgSettings } from "@/hooks/use-manufacturing";
import { useCategories, type useMenuItems, type MenuItem } from "@/hooks/use-menu";
import { formatCurrency } from "@/lib/format";
import { toInclusivePrice } from "@/lib/pricing-preview";
import { findItemByCode } from "@/lib/pos-scan";

export function ProductGrid({
  branchId,
  onSelect,
  menu,
  pauseLabels,
  taxMode = "INCLUSIVE",
}: {
  branchId: string | null;
  onSelect: (item: MenuItem) => void;
  menu: ReturnType<typeof useMenuItems>;
  pauseLabels: ReadonlyMap<string, string>;
  taxMode?: "INCLUSIVE" | "EXCLUSIVE";
}) {
  const { data: categories } = useCategories(branchId);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const { data: items, isLoading, isError, error, refetch, isFetching } = menu;

  // Optional line under each price: the posted production cost (today's when there was a batch today). Off until someone
  // switches it on here, remembered on this device. Only shown to people allowed to see cost reports, and only when costing is on.
  const { data: mfg } = useMfgSettings(branchId);
  const canSeeCost = !!mfg?.enabled && mfg.canReport;
  const [showCost, setShowCost] = useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("pos.showProductionCost") === "1"; } catch { return false; }
  });
  const toggleCost = () => {
    const next = !showCost;
    setShowCost(next);
    try { localStorage.setItem("pos.showProductionCost", next ? "1" : "0"); } catch { /* not remembered */ }
  };
  const { data: costs } = useMenuCosts(branchId, canSeeCost && showCost);
  const costOf = new Map((costs?.items ?? []).map((c) => [c.menuItemId, c]));

  // Archived items (deleted but kept for old orders) are not for sale. A typed/scanned barcode or SKU also finds its item.
  const sellable = items?.filter((i) => i.isActive && (!activeCategoryId || i.categoryId === activeCategoryId));
  const needle = search.toLowerCase();
  const filtered = sellable?.filter(
    (i) => i.name.toLowerCase().includes(needle) || (!!needle && findItemByCode([i], search) === i),
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search menu…"
          aria-label="Search menu"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            // A scanner focused in this box ends with Enter: add the exact barcode/SKU match and clear the box.
            if (e.key !== "Enter") return;
            const hit = findItemByCode(items, search);
            if (!hit) return;
            e.preventDefault();
            onSelect(hit);
            setSearch("");
          }}
          className="h-11 sm:flex-1"
        />
        {categories && categories.length > 0 && (
          <Select
            value={activeCategoryId ?? "all"}
            onValueChange={(v) => setActiveCategoryId(!v || v === "all" ? undefined : v)}
          >
            <SelectTrigger aria-label="Category" className="h-11 w-full sm:w-56">
              <SelectValue>
                {(value: string | null) => {
                  const c = categories.find((x) => x.id === value);
                  return c ? `${c.name} (${c._count.items})` : "All categories";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c._count.items})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {canSeeCost && (
          <button
            type="button"
            role="switch"
            aria-checked={showCost}
            onClick={toggleCost}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span aria-hidden className={`relative inline-block h-5 w-9 rounded-full transition-colors ${showCost ? "bg-primary" : "bg-muted-foreground/40"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${showCost ? "left-[1.125rem]" : "left-0.5"}`} />
            </span>
            Show cost today
          </button>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {isError && !items ? (
        <QueryError error={error} what="the menu" onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {filtered?.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.name}
            disabled={pauseLabels.has(item.id)}
            onClick={() => onSelect(item)}
            className="flex min-h-24 min-w-0 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-3 text-left sm:p-4 shadow-sm transition-all enabled:hover:-translate-y-0.5 enabled:hover:shadow-md enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-muted/30 lg:min-h-32 lg:justify-between lg:p-4 lg:enabled:hover:border-primary/50"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${item.isVeg ? "bg-success" : "bg-destructive"}`}
            />
            <span className="line-clamp-3 w-full min-w-0 [overflow-wrap:anywhere] text-sm font-medium leading-tight text-foreground lg:text-[15px]">
              {item.name}
            </span>
            <PauseBadge label={pauseLabels.get(item.id)} />
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums text-foreground lg:text-base">
                {formatCurrency(
                  toInclusivePrice(
                    Number(item.price),
                    Number(item.taxRatePercent ?? 0),
                    taxMode,
                  ),
                )}
              </span>
              {item.halfPrice != null && (
                <span className="hidden text-[11px] tabular-nums text-muted-foreground lg:inline">
                  Half{" "}
                  {formatCurrency(
                    toInclusivePrice(
                      Number(item.halfPrice),
                      Number(item.taxRatePercent ?? 0),
                      taxMode,
                    ),
                  )}
                </span>
              )}
            </span>
            {showCost && costOf.get(item.id) && (() => {
              const c = costOf.get(item.id)!;
              return (
                <span className="w-full border-t border-border/70 pt-1 text-[11px] leading-snug text-muted-foreground" data-testid="pos-production-cost">
                  {c.isToday ? "Today\u2019s production cost" : `Production cost (${new Date(`${c.costDate}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, not today)`}{" "}
                  <b className="tabular-nums text-foreground">{formatCurrency(c.costPerPortion)}</b>
                  <span className="hidden lg:block">Difference {formatCurrency(c.indicativeDifference)} before expenses, discounts and tax</span>
                </span>
              );
            })()}
          </button>
        ))}
        {filtered?.length === 0 && !isLoading && (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
            {search ? <>No items match &quot;{search}&quot;</> : "No items in this category yet"}
          </p>
        )}
      </div>
      )}
      </div>
    </div>
  );
}
