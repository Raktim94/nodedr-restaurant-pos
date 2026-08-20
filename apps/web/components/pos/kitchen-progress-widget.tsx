"use client";

import type { KotStatusDto } from "@nodedr-restaurant/types";
import { ChefHat } from "lucide-react";
import { useKdsTickets } from "@/hooks/use-kds";
import { cn } from "@/lib/utils";

const COLUMNS: { status: KotStatusDto; label: string; dotClass: string }[] = [
  { status: "NEW", label: "New", dotClass: "bg-primary" },
  { status: "ACCEPTED", label: "Accepted", dotClass: "bg-warning" },
  { status: "PREPARING", label: "Preparing", dotClass: "bg-warning" },
  { status: "READY", label: "Ready", dotClass: "bg-success" },
];

// A single-line kitchen-status glance for the POS screen — counts only, no
// ticket cards or station columns (that's the full Kitchen Display page's
// job). Silently renders nothing if the ticket count can't be loaded
// (e.g. this staff member's role has no kds.manage permission) rather than
// showing an error in a screen that's meant to stay clean and unhurried.
export function KitchenProgressWidget({ branchId }: { branchId: string | null }) {
  const { data: tickets, isError } = useKdsTickets(branchId);
  if (isError || !tickets) return null;

  const countOf = (status: KotStatusDto) => tickets.filter((t) => t.status === status).length;
  const active = tickets.filter((t) => t.status !== "SERVED" && t.status !== "CANCELLED");
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
