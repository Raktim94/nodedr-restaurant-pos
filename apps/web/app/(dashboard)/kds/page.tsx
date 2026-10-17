"use client";

import type { KotStatusDto } from "@nodedr-restaurant/types";
import { useEffect, useState } from "react";
import { PerformanceWidget } from "@/components/kds/performance-widget";
import { TicketCard } from "@/components/kds/ticket-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useKdsSound } from "@/hooks/use-kds-sound";
import { useKdsStations, useKdsTickets, type KotTicket } from "@/hooks/use-kds";
import { cn } from "@/lib/utils";

const COLUMNS: { status: KotStatusDto; label: string }[] = [
  { status: "NEW", label: "New" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "PREPARING", label: "Preparing" },
  { status: "READY", label: "Ready" },
];

// The station this screen is pinned to is remembered per device + branch, so a
// kitchen tablet reopens on its own station after a reload or restart.
const stationKey = (branchId: string | null) => `kds-station:${branchId}`;

export default function KdsPage() {
  const { branchId } = useBranch();
  const [stationId, setStationId] = useState("");
  const { data: stations } = useKdsStations(branchId);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStationId(localStorage.getItem(stationKey(branchId)) ?? "");
    } catch {
      /* storage blocked: stay on "all stations" */
    }
  }, [branchId]);
  // A saved station that was since deleted must not leave the screen empty.
  const activeStation = stations?.some((s) => s.id === stationId) ? stationId : "";
  const chooseStation = (id: string) => {
    setStationId(id);
    try {
      localStorage.setItem(stationKey(branchId), id);
    } catch {
      /* storage blocked: choice lasts until reload */
    }
  };
  const { data: tickets, isLoading } = useKdsTickets(branchId, activeStation);
  useKdsSound(branchId);

  const byStatus = (status: KotStatusDto): KotTicket[] =>
    tickets?.filter((t) => t.status === status) ?? [];

  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-6 lg:h-[calc(100dvh-8rem)]">
      <div>
        <h1 className="text-2xl font-semibold sm:text-[32px] tracking-tight text-foreground">
          Kitchen Display
        </h1>
        <p className="text-sm text-muted-foreground">Live order tickets by station</p>
      </div>

      {stations && stations.length > 0 && (
        <div role="group" aria-label="Station" className="flex flex-wrap gap-2">
          {[{ id: "", name: "All stations" }, ...stations].map((s) => (
            <button
              key={s.id || "all"}
              type="button"
              aria-pressed={s.id === activeStation}
              onClick={() => chooseStation(s.id)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                s.id === activeStation
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <PerformanceWidget branchId={branchId} />

      <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-hidden xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex w-[85%] shrink-0 snap-center flex-col gap-3 overflow-hidden rounded-2xl bg-secondary/40 p-3 sm:w-auto sm:shrink">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-foreground">{col.label}</h2>
              <span className="text-xs font-medium text-muted-foreground">
                {byStatus(col.status).length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
              {isLoading &&
                Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-2xl" />
                ))}
              {byStatus(col.status).map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} branchId={branchId} />
              ))}
              {!isLoading && byStatus(col.status).length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">No tickets</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
