"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponsiveTabs } from "@/components/ui/nav-picker";
import { useCategories, useMenuItems, type MenuItem } from "@/hooks/use-menu";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

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

  const filtered = items?.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-3.5">
      <Input
        placeholder="Search menu items, ingredients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-11 rounded-xl text-xs sm:text-sm font-medium bg-background"
      />

      {categories && categories.length > 0 && (
        <ResponsiveTabs
          mobileOnly
          className="lg:hidden"
          label="Category"
          value={activeCategoryId ?? "all"}
          onChange={(id) => setActiveCategoryId(id === "all" ? undefined : id)}
          desktopListClassName="justify-start lg:h-auto lg:flex-wrap"
          items={[{ id: "all", label: "All Items" }, ...categories.map((c) => ({ id: c.id, label: c.name, hint: `${c._count.items} items` }))]}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-4">
      {categories && categories.length > 0 && (
        <nav
          aria-label="Category"
          className="hidden w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/70 pr-3 lg:flex xl:w-56 scrollbar-none"
        >
          {[{ id: undefined as string | undefined, name: "All Items", count: undefined as number | undefined }, ...categories.map((c) => ({ id: c.id as string | undefined, name: c.name, count: c._count.items as number | undefined }))].map((c) => {
            const active = c.id === activeCategoryId;
            return (
              <button
                key={c.id ?? "all"}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => setActiveCategoryId(c.id)}
                className={cn(
                  "flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs sm:text-sm transition-all active:scale-97 select-none",
                  active
                    ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                    : "font-medium text-foreground hover:bg-secondary/70",
                )}
              >
                <span className="min-w-0 truncate leading-tight" title={c.name}>
                  {c.name}
                </span>
                {c.count !== undefined && (
                  <span className={cn("shrink-0 text-xs tabular-nums font-semibold", active ? "opacity-90" : "text-muted-foreground")}>
                    {c.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {isError && !items ? (
        <QueryError error={error} what="the menu" onRetry={() => void refetch()} retrying={isFetching} />
      ) : (
      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 sm:gap-3 overflow-y-auto pb-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 scrollbar-none">
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {filtered?.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.name}
            onClick={() => onSelect(item)}
            className="group relative flex min-h-[110px] min-w-0 flex-col justify-between rounded-2xl border border-border/80 bg-card p-3 sm:p-3.5 text-left shadow-2xs transition-all duration-150 hover:border-primary/50 hover:shadow-xs active:scale-[0.97]"
          >
            <div className="flex w-full items-start justify-between gap-2">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.isVeg ? "bg-emerald-500 shadow-xs shadow-emerald-500/30" : "bg-destructive shadow-xs shadow-destructive/30"}`}
                title={item.isVeg ? "Vegetarian" : "Non-vegetarian"}
              />
              {item.halfPrice != null && (
                <span className="shrink-0 rounded-md bg-secondary/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  Half {formatCurrency(item.halfPrice)}
                </span>
              )}
            </div>
            <div className="mt-1 flex w-full flex-1 flex-col justify-end">
              <span className="line-clamp-2 w-full min-w-0 text-[13.5px] font-semibold leading-snug text-foreground group-hover:text-primary transition-colors sm:text-sm">
                {item.name}
              </span>
              <div className="mt-2 flex w-full items-baseline justify-between">
                <span className="text-[15px] font-bold tracking-tight tabular-nums text-foreground">
                  {formatCurrency(item.price)}
                </span>
              </div>
            </div>
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
    </div>
  );
}
