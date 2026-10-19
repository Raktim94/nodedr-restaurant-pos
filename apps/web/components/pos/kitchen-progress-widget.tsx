"use client";

import type { KotStatusDto } from "@nodedr-restaurant/types";
import { ChefHat, RefreshCw } from "lucide-react";
import { useKdsProgress } from "@/hooks/use-kds";
import { cn } from "@/lib/utils";

const COLUMNS: { status: KotStatusDto; label: string; dotClass: string }[] = [
  { status: "NEW", label: "New", dotClass: "bg-primary" },
  { status: "ACCEPTED", label: "Accepted", dotClass: "bg-warning" },
  { status: "PREPARING", label: "Preparing", dotClass: "bg-warning" },
  { status: "READY", label: "Ready to serve", dotClass: "bg-success" },
];

// A single-line kitchen-status glance for the POS screen - counts only, no
// guest details (that is the full Kitchen Display's job, and needs a kitchen
// role). It reads the order-taking progress feed, so a waiter or cashier sees
// live progress without holding any kitchen permission. If the feed cannot be
// loaded it says so and offers a retry rather than quietly showing nothing.
export function KitchenProgressWidget({ branchId }: { branchId: string | null }) {
  const { data: tickets, isError, refetch, isFetching } = useKdsProgress(branchId);

  if (isError && !tickets) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        <ChefHat className="h-3.5 w-3.5" aria-hidden />
        Kitchen progress is unavailable right now.
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1 font-medium text-primary hover:underline disabled:opacity-60"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} aria-hidden />
          Retry
        </button>
      </div>
    );
  }
  if (!tickets) return null;

  const countOf = (status: KotStatusDto) => tickets.filter((t) => t.status === status).length;
  const active = tickets.filter((t) => t.status !== "SERVED");
  if (active.length === 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2 text-xs">
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground">
        <ChefHat className="h-3.5 w-3.5" />
        Kitchen
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {COLUMNS.map((col) => {
          const count = countOf(col.status);
          if (count === 0) return null;
          return (
            <span key={col.status} className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", col.dotClass)} />
              <span className="text-muted-foreground">{col.label}</span>
              <span className="font-semibold tabular-nums text-foreground">{count}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
