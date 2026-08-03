"use client";

import { Flame, Printer, Star, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  NEXT_STATUS,
  useReprintKot,
  useSetKotPriority,
  useUpdateKotStatus,
  type KotTicket,
} from "@/hooks/use-kds";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  NEW: "Accept",
  ACCEPTED: "Start preparing",
  PREPARING: "Mark ready",
  READY: "Mark served",
};

function useElapsedMinutes(createdAt: string) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const compute = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)));
    compute();
    const id = setInterval(compute, 30_000);
    return () => clearInterval(id);
  }, [createdAt]);
  return elapsed;
}

export function TicketCard({ ticket, branchId }: { ticket: KotTicket; branchId: string | null }) {
  const elapsed = useElapsedMinutes(ticket.createdAt);
  const updateStatus = useUpdateKotStatus(branchId);
  const setPriority = useSetKotPriority(branchId);
  const reprint = useReprintKot(branchId);
  const nextStatus = NEXT_STATUS[ticket.status];
  const isLate = elapsed >= 15;

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-4",
        (isLate || ticket.isPriority) && "border-warning/50 ring-1 ring-warning/30",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            #{ticket.order.orderNumber}
            {ticket.isPriority && <Star className="h-3.5 w-3.5 fill-warning text-warning" />}
          </p>
          <p className="text-xs text-muted-foreground">
            {ticket.order.table ? `Table ${ticket.order.table.number}` : ticket.order.type}
            {ticket.station && ` · ${ticket.station.name}`}
          </p>
        </div>
        <div
          className={cn(
            "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium tabular-nums",
            isLate ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground",
          )}
        >
          <Timer className="h-3 w-3" />
          {elapsed}m
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {ticket.items.map((item) => (
          <div key={item.id} className="text-sm">
            <p className="font-medium text-foreground">
              {item.orderItem.quantity}× {item.orderItem.nameSnapshot}
            </p>
            {item.orderItem.modifiers.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {item.orderItem.modifiers.map((m) => m.nameSnapshot).join(", ")}
              </p>
            )}
            {item.orderItem.kitchenNote && (
              <p className="flex items-center gap-1 text-xs text-warning">
                <Flame className="h-3 w-3" /> {item.orderItem.kitchenNote}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {nextStatus && (
          <Button
            size="sm"
            className="flex-1"
            disabled={updateStatus.isPending}
            onClick={() => updateStatus.mutate({ id: ticket.id, status: nextStatus })}
          >
            {STATUS_LABEL[ticket.status]}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          title={ticket.isPriority ? "Unmark priority" : "Mark priority"}
          disabled={setPriority.isPending}
          onClick={() =>
            setPriority.mutate({ id: ticket.id, isPriority: !ticket.isPriority })
          }
        >
          <Star className={cn("h-4 w-4", ticket.isPriority && "fill-warning text-warning")} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          title="Reprint ticket"
          disabled={reprint.isPending}
          onClick={() =>
            reprint.mutate(ticket.id, {
              onSuccess: () => toast.success("Ticket sent to reprint"),
            })
          }
        >
          <Printer className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
