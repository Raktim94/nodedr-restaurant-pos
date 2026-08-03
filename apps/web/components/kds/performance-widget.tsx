"use client";

import { Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useKitchenPerformance } from "@/hooks/use-kds";

export function PerformanceWidget({ branchId }: { branchId: string | null }) {
  const { data } = useKitchenPerformance(branchId);

  if (!data || data.length === 0) return null;

  return (
    <Card className="flex items-center gap-4 overflow-x-auto p-3">
      <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" />
        Avg. time to ready today
      </div>
      {data.map((row) => (
        <div key={row.stationId} className="flex shrink-0 items-baseline gap-1.5 text-sm">
          <span className="text-muted-foreground">{row.stationName}</span>
          <span className="font-semibold tabular-nums text-foreground">
            {row.avgMinutesToReady}m
          </span>
          <span className="text-xs text-muted-foreground">({row.ticketsReady})</span>
        </div>
      ))}
    </Card>
  );
}
