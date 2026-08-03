"use client";

import type { KotStatusDto } from "@nodedr-restaurant/types";
import { TicketCard } from "@/components/kds/ticket-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useKdsTickets, type KotTicket } from "@/hooks/use-kds";
import { useRealtime } from "@/hooks/use-realtime";

const COLUMNS: { status: KotStatusDto; label: string }[] = [
  { status: "NEW", label: "New" },
  { status: "ACCEPTED", label: "Accepted" },
  { status: "PREPARING", label: "Preparing" },
  { status: "READY", label: "Ready" },
];

export default function KdsPage() {
  const { branchId } = useBranch();
  const { data: tickets, isLoading } = useKdsTickets(branchId);
  useRealtime(branchId);

  const byStatus = (status: KotStatusDto): KotTicket[] =>
    tickets?.filter((t) => t.status === status) ?? [];

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">
          Kitchen Display
        </h1>
        <p className="text-sm text-muted-foreground">Live order tickets by station</p>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex flex-col gap-3 overflow-hidden rounded-2xl bg-secondary/40 p-3">
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
