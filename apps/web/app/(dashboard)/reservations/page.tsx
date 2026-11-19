"use client";

import type { ReservationStatusDto } from "@nodedr-restaurant/types";
import { Check, X, Users, Calendar, Phone, Clock, Plus, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { AddReservationDialog } from "@/components/reservations/add-reservation-dialog";
import { ChannelBadge } from "@/components/orders/channel-badges";
import { ReservationManageDialog } from "@/components/reservations/reservation-manage-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useReservations, useUpdateReservationStatus, type Reservation } from "@/hooks/use-reservations";
import { useFloors } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ReservationStatusDto, string> = {
  RESERVED: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  CONFIRMED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  ARRIVED: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  COMPLETED: "bg-muted text-muted-foreground border border-border/60",
  CANCELLED: "bg-destructive/10 text-destructive border border-destructive/20",
  NO_SHOW: "bg-destructive/10 text-destructive border border-destructive/20",
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
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [channel, setChannel] = useState<"all" | "ONLINE" | "STAFF">("all");
  const visible = reservations?.filter((r) => channel === "all" || r.channel === channel);

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Reservations
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Upcoming bookings and table holds across all floors
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddReservationDialog branchId={branchId} tables={tables} />
        </div>
      </div>

      <ReservationManageDialog
        branchId={branchId}
        reservation={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      {/* Segmented Filter Control */}
      <div className="inline-flex w-fit items-center rounded-xl bg-secondary/80 p-1 border border-border/50 text-xs font-medium">
        {(
          [
            ["all", "All bookings"],
            ["ONLINE", "Online"],
            ["STAFF", "Offline / walk-in"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setChannel(key)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 transition-all text-xs font-semibold",
              channel === key
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Reservations List */}
      <Card className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border-border/60 bg-card shadow-xs">
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : visible && visible.length > 0 ? (
          visible.map((r) => {
            const resDate = new Date(r.reservedAt);
            const dateStr = resDate.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
            });
            const timeStr = resDate.toLocaleString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            });

            return (
              <div
                key={r.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 p-4 transition-colors hover:bg-muted/30"
              >
                {/* Left details - Clickable to manage */}
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className="flex flex-col text-left gap-1.5 flex-1 min-w-0"
                  title="Manage booking"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-semibold text-foreground tracking-tight">
                      {r.customerName}
                    </span>
                    <ChannelBadge channel={r.channel} />
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.guestCount} {r.guestCount === 1 ? "guest" : "guests"}
                    </span>
                    {r.table && (
                      <span className="inline-flex items-center gap-1">
                        <UtensilsCrossed className="h-3 w-3 text-muted-foreground" />
                        {r.table.name ?? `Table ${r.table.number}`}
                      </span>
                    )}
                    {r.phone && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {r.phone}
                      </span>
                    )}
                  </div>
                </button>

                {/* Right controls: Date/Time + Accept/Reject + Status Dropdown */}
                <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t border-border/40 sm:border-0">
                  {/* Time Badge */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-secondary/60 text-xs font-semibold text-foreground tabular-nums border border-border/40">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{dateStr}, {timeStr}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Quick Accept/Reject for pending bookings */}
                    {r.status === "RESERVED" && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          className="h-8 w-8 rounded-lg text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-95 transition-transform"
                          title="Accept reservation"
                          onClick={() => updateStatus.mutate({ id: r.id, status: "CONFIRMED" })}
                        >
                          <Check className="h-4 w-4 stroke-[2.5]" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="icon-sm"
                          className="h-8 w-8 rounded-lg text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 active:scale-95 transition-transform"
                          title="Reject reservation"
                          onClick={() => updateStatus.mutate({ id: r.id, status: "CANCELLED" })}
                        >
                          <X className="h-4 w-4 stroke-[2.5]" />
                        </Button>
                      </div>
                    )}

                    {/* Status Dropdown Pill */}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition active:scale-95 focus:outline-none",
                          STATUS_STYLES[r.status],
                        )}
                      >
                        {r.status.replace("_", " ")}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40 rounded-xl">
                        {STATUS_FLOW.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            disabled={status === r.status}
                            onClick={() => updateStatus.mutate({ id: r.id, status })}
                            className="text-xs font-medium cursor-pointer"
                          >
                            {status.replace("_", " ")}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground mb-1">
              <Calendar className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">No reservations yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Add a booking to reserve a table in advance for guests.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
