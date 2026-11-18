"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMenuCosts } from "@/hooks/use-manufacturing";
import { useCategories, useMenuItems, type MenuItem } from "@/hooks/use-menu";
import { formatCurrency } from "@/lib/format";

export function ProductGrid({
  branchId,
  onSelect,
}: {
  branchId: string | null;
  onSelect: (item: MenuItem) => void;
}) {
  const { data: categories } = useCategories(branchId);
  const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const { data: items, isLoading, isError, error, refetch, isFetching } = useMenuItems(branchId, activeCategoryId);

  // Posted production cost per item. Only people allowed to see reports get an answer; for everyone else this stays empty.
  const { data: costs } = useMenuCosts(branchId);
  const costOf = new Map((costs?.items ?? []).map((c) => [c.menuItemId, c]));

  const filtered = items?.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search menu…"
          aria-label="Search menu"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
            onClick={() => onSelect(item)}
            className="flex min-h-24 min-w-0 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-3 text-left sm:p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] active:translate-y-0 lg:min-h-32 lg:justify-between lg:p-4 lg:hover:border-primary/50"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${item.isVeg ? "bg-success" : "bg-destructive"}`}
            />
            <span className="line-clamp-3 w-full min-w-0 [overflow-wrap:anywhere] text-sm font-medium leading-tight text-foreground lg:text-[15px]">
              {item.name}
            </span>
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="text-sm font-semibold tabular-nums text-foreground lg:text-base">
                {formatCurrency(item.price)}
              </span>
              {item.halfPrice != null && (
                <span className="hidden text-[11px] tabular-nums text-muted-foreground lg:inline">
                  Half {formatCurrency(item.halfPrice)}
                </span>
              )}
            </span>
            {costOf.get(item.id) && (() => {
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
