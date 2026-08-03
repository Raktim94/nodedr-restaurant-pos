"use client";

import type { ReservationStatusDto } from "@nodedr-restaurant/types";
import { Users } from "lucide-react";
import { AddReservationDialog } from "@/components/reservations/add-reservation-dialog";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useReservations, useUpdateReservationStatus } from "@/hooks/use-reservations";
import { useFloors } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ReservationStatusDto, string> = {
  RESERVED: "bg-secondary text-muted-foreground",
  CONFIRMED: "bg-primary/10 text-primary",
  ARRIVED: "bg-success/10 text-success",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-destructive/10 text-destructive",
  NO_SHOW: "bg-destructive/10 text-destructive",
};

const STATUS_FLOW: ReservationStatusDto[] = [
  "RESERVED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

export default function ReservationsPage() {
  const { branchId } = useBranch();
  const { data: reservations, isLoading } = useReservations(branchId);
  const { data: floors } = useFloors(branchId);
  const tables = floors?.flatMap((f) => f.tables) ?? [];
  const updateStatus = useUpdateReservationStatus(branchId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">
            Reservations
          </h1>
          <p className="text-sm text-muted-foreground">Upcoming bookings across all floors</p>
        </div>
        <AddReservationDialog branchId={branchId} tables={tables} />
      </div>

      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : reservations && reservations.length > 0 ? (
          reservations.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{r.customerName}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  {r.guestCount} guests
                  {r.table && <> · {r.table.name ?? `Table ${r.table.number}`}</>}
                  {r.phone && <> · {r.phone}</>}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-muted-foreground">
                  {new Date(r.reservedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      STATUS_STYLES[r.status],
                    )}
                  >
                    {r.status.replace("_", " ")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {STATUS_FLOW.map((status) => (
                      <DropdownMenuItem
                        key={status}
                        disabled={status === r.status}
                        onClick={() => updateStatus.mutate({ id: r.id, status })}
                      >
                        {status.replace("_", " ")}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No reservations yet</p>
            <p className="text-sm text-muted-foreground">
              Add a booking to hold a table for a guest.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
