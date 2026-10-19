"use client";

import { Check, Clock, Globe, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { ReasonDialog } from "@/components/orders/reason-dialog";
import { useAcceptIncoming, useDeclineIncoming, type IncomingOrder } from "@/hooks/use-kds";
import { ApiError } from "@/lib/api";

const DECLINE_REASONS = ["Closing soon", "Out of stock", "Too busy", "Outside delivery area"];

function minutesSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

// An order that has come in but nobody has answered yet. It has no kitchen
// ticket until it is accepted, so it lives here, above the ticket columns,
// with a big Accept and a deliberate Decline.
export function IncomingOrderCard({ order, branchId }: { order: IncomingOrder; branchId: string | null }) {
  const accept = useAcceptIncoming(branchId);
  const decline = useDeclineIncoming(branchId);
  const [declineOpen, setDeclineOpen] = useState(false);
  const { note, clear, toast } = useNoteToast();
  const who = order.guestName || order.customer?.name || null;

  return (
    <Card className="flex w-[22rem] max-w-full shrink-0 flex-col gap-3 border-primary p-4 ring-2 ring-primary/30">
      <StatusNote note={note} onClear={clear} />
      <ReasonDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title={`Decline order #${order.orderNumber}?`}
        description="The guest's order is not made and nothing is charged. It stays in History with your reason and name."
        reasons={DECLINE_REASONS}
        confirmLabel="Decline order"
        keepLabel="Go back"
        onSubmit={(reason) => decline.mutateAsync({ orderId: order.id, reason })}
      />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            #{order.orderNumber}
            {order.channel === "ONLINE" && <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-label="Online order" />}
          </p>
          <p className="text-xs text-muted-foreground">
            {order.table ? `Table ${order.table.number}` : order.type.replace("_", " ")}
            {who && ` · ${who}`}
          </p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden />
          {minutesSince(order.createdAt)}m
        </span>
      </div>
      {order.notes && <p className="rounded-lg bg-warning/10 px-2 py-1.5 text-xs text-warning">{order.notes}</p>}
      <ul className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
        {order.items.map((item) => (
          <li key={item.id}>
            <span className="font-medium text-foreground">
              {item.quantity}× {item.nameSnapshot}
            </span>
            {item.modifiers.length > 0 && (
              <span className="block text-xs text-muted-foreground">
                {item.modifiers.map((m) => m.nameSnapshot).join(", ")}
              </span>
            )}
            {item.kitchenNote && <span className="block text-xs text-warning">{item.kitchenNote}</span>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          className="h-12 flex-1 text-base"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(order.id, {
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : "Could not accept the order. Try again."),
            })
          }
        >
          <Check className="h-5 w-5" aria-hidden />
          {accept.isPending ? "Accepting…" : "Accept"}
        </Button>
        <Button variant="destructive" className="h-12 px-4" onClick={() => setDeclineOpen(true)}>
          <X className="h-5 w-5" aria-hidden />
          Decline
        </Button>
      </div>
    </Card>
  );
}
