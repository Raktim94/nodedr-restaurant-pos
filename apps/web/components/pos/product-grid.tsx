"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipBar } from "@/components/ui/chip-bar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: items, isLoading } = useMenuItems(branchId, activeCategoryId);

  const filtered = items?.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search menu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 min-w-0 flex-1"
        />
        {categories && categories.length > 6 && (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 gap-2 px-3"
            aria-label="Browse all categories"
            onClick={() => setPickerOpen(true)}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden min-[400px]:inline">All categories</span>
          </Button>
        )}
      </div>

      {categories && categories.length > 0 && (
        <ChipBar
          ariaLabel="Menu category"
          value={activeCategoryId ?? "all"}
          onChange={(id) => setActiveCategoryId(id === "all" ? undefined : id)}
          items={[{ id: "all", label: "All" }, ...categories.map((c) => ({ id: c.id, label: c.name }))]}
        />
      )}

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl p-0">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle>Jump to category</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] min-[420px]:grid-cols-3">
            {[{ id: "all", name: "All", count: undefined as number | undefined }, ...(categories ?? []).map((c) => ({ id: c.id, name: c.name, count: c._count.items }))].map((c) => {
              const active = (activeCategoryId ?? "all") === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setActiveCategoryId(c.id === "all" ? undefined : c.id);
                    setPickerOpen(false);
                  }}
                  className={cn(
                    "flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors active:scale-[0.97]",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground active:bg-secondary",
                  )}
                >
                  <span className="break-words leading-tight">{c.name}</span>
                  {c.count !== undefined && (
                    <span className={cn("text-xs font-normal", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
                      {c.count} items
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        {filtered?.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="flex min-h-24 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-3 text-left sm:p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] active:translate-y-0"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${item.isVeg ? "bg-success" : "bg-destructive"}`}
            />
            <span className="text-sm font-medium leading-tight text-foreground">{item.name}</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {formatCurrency(item.price)}
            </span>
          </button>
        ))}
        {filtered?.length === 0 && !isLoading && (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
            {search ? <>No items match &quot;{search}&quot;</> : "No items in this category yet"}
          </p>
        )}
      </div>
    </div>
  );
}
