"use client";

import { Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useKitchenPerformance } from "@/hooks/use-kds";

export function PerformanceWidget({ branchId }: { branchId: string | null }) {
  const { data } = useKitchenPerformance(branchId);

  if (!data || data.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 py-2 rounded-xl bg-secondary/50 border border-border/50 text-xs">
      <div className="flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground">
        <Gauge className="h-3.5 w-3.5 text-primary" />
        <span className="hidden sm:inline">Avg. time to ready today:</span>
        <span className="sm:hidden">Avg. ready:</span>
      </div>
      <div className="flex items-center gap-3 overflow-x-auto">
        {data.map((row) => (
          <div key={row.stationId} className="flex shrink-0 items-baseline gap-1.5">
            <span className="text-muted-foreground font-medium">{row.stationName}</span>
            <span className="font-bold tabular-nums text-foreground">
              {row.avgMinutesToReady}m
            </span>
            <span className="text-[11px] text-muted-foreground/80 font-mono">({row.ticketsReady})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
