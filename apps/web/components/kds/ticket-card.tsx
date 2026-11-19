"use client";

import { ApiError } from "@/lib/api";
import { CloudOff, Flame, Globe, Printer, Star, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContactDetailsDialog } from "@/components/contact-details-dialog";
import { ReasonDialog } from "@/components/orders/reason-dialog";
import { useCallBuzzer } from "@/hooks/use-paging";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import {
  NEXT_STATUS,
  useRejectKot,
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

const REJECT_REASONS = ["Out of stock", "Item unavailable", "Kitchen too busy", "Equipment problem"];

// A ticket this young is new enough to draw the eye (and it stops on its own).
const FRESH_MINUTES = 2;

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

function customerDisplayName(order: KotTicket["order"]) {
  return order.customer?.name || order.guestName || null;
}

function customerPhone(order: KotTicket["order"]) {
  return order.customer?.phone || null;
}

export function TicketCard({ ticket, branchId }: { ticket: KotTicket; branchId: string | null }) {
  const elapsed = useElapsedMinutes(ticket.createdAt);
  const updateStatus = useUpdateKotStatus(branchId);
  const setPriority = useSetKotPriority(branchId);
  const reprint = useReprintKot(branchId);
  const { note, clear: clearNote, toast } = useNoteToast();
  const nextStatus = NEXT_STATUS[ticket.status];
  const isLate = elapsed >= 15;
  const isFresh = ticket.status === "NEW" && elapsed < FRESH_MINUTES;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const reject = useRejectKot(branchId);
  const callBuzzer = useCallBuzzer(branchId);
  const { data: me } = useCurrentUser();
  // Rejecting before cooking starts is for anyone on the kitchen screen; food
  // already on the stove is a manager's call (the server enforces the same).
  const started = ticket.status === "PREPARING";
  const canReject =
    (ticket.status === "NEW" || ticket.status === "ACCEPTED" || started) &&
    (!started || hasPermission(me?.user, "orders.cancel"));

  return (
    <Card
      className={cn(
        "flex shrink-0 flex-col gap-3 p-3.5 rounded-2xl border-border/70 bg-card shadow-xs transition-shadow",
        (isLate || ticket.isPriority) && "border-amber-500/50 ring-1 ring-amber-500/30",
        isFresh && "border-primary ring-2 ring-primary/40 motion-safe:animate-pulse",
      )}
    >
      <StatusNote note={note} onClear={clearNote} />
      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ticket for order #${ticket.order.orderNumber}?`}
        description={
          ticket.order.table
            ? `Table ${ticket.order.table.number} will be told the kitchen cannot make this. The ticket stays on record with your name and reason.`
            : "The guest will be told the kitchen cannot make this. The ticket stays on record with your name and reason."
        }
        warning={started ? "This ticket is already being prepared. Rejecting it means the food in progress is wasted." : undefined}
        reasons={REJECT_REASONS}
        confirmLabel="Reject ticket"
        keepLabel="Keep ticket"
        onSubmit={(reason) =>
          reject.mutateAsync({ id: ticket.id, reason, confirmStarted: started ? true : undefined })
        }
      />
      <ContactDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={`Order #${ticket.order.orderNumber}`}
        name={customerDisplayName(ticket.order)}
        subtitle={ticket.order.table ? `Table ${ticket.order.table.number}` : ticket.order.type}
        phone={customerPhone(ticket.order)}
        waMessage={`Hi ${customerDisplayName(ticket.order) ?? ""}, this is regarding your order #${ticket.order.orderNumber}.`}
      />
      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        className="flex items-center justify-between rounded-md text-left transition hover:opacity-80 gap-2"
        title="View customer details"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <span className="font-mono tracking-tight">#{ticket.order.orderNumber}</span>
            {ticket.isPriority && <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500 shrink-0" />}
            {ticket.order.channel === "ONLINE" && (
              <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Online order" />
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            <span className="font-semibold text-foreground/85">
              {ticket.order.table ? `Table ${ticket.order.table.number}` : ticket.order.type}
            </span>
            {ticket.station && ` · ${ticket.station.name}`}
            {customerDisplayName(ticket.order) && ` · ${customerDisplayName(ticket.order)}`}
          </p>
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums border",
            isLate
              ? "bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30"
              : "bg-secondary/80 text-muted-foreground border-border/50",
          )}
        >
          <Timer className="h-3 w-3" />
          {elapsed}m
        </div>
      </button>

      {ticket.savedOnPhone && (
        <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-400 font-medium">
          <CloudOff className="h-3.5 w-3.5" aria-hidden /> Saved offline
        </p>
      )}

      {ticket.order.notes && (
        <p className="flex items-start gap-1 rounded-xl bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
          <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {ticket.order.notes}
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-border/60 pt-2.5">
        {ticket.items.map((item) => (
          <div key={item.id} className="text-sm">
            <p className="font-semibold text-foreground tracking-tight">
              <span className="text-primary font-bold mr-1">{item.orderItem.quantity}×</span>
              {item.orderItem.nameSnapshot}
            </p>
            {item.orderItem.modifiers.length > 0 && (
              <p className="text-xs text-muted-foreground pl-4">
                {item.orderItem.modifiers.map((m) => m.nameSnapshot).join(", ")}
              </p>
            )}
            {item.orderItem.kitchenNote && (
              <p className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-400 pl-4 font-medium">
                <Flame className="h-3 w-3" /> {item.orderItem.kitchenNote}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-1">
        {ticket.status === "READY" && ticket.order.table && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 rounded-xl font-medium active:scale-95 transition-transform"
            disabled={callBuzzer.isPending}
            onClick={() =>
              callBuzzer.mutate(
                { orderId: ticket.orderId },
                {
                  onSuccess: (r) =>
                    r.call.state === "FAILED"
                      ? toast.error(`The buzzer could not be reached (${r.call.error ?? "no answer"}). Call the guest by name.`)
                      : r.deviceOnline === false
                        ? toast.error("The buzzer looks offline. The call is queued; call the guest by name too.")
                        : toast.success(r.duplicate ? "Already paging this table" : `Paging table ${ticket.order.table?.number}`),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not page the table"),
                },
              )
            }
          >
            Call buzzer
          </Button>
        )}
        {nextStatus && (
          <Button
            className="h-11 w-full rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform shadow-xs"
            disabled={updateStatus.isPending}
            onClick={() =>
              updateStatus.mutate(
                { id: ticket.id, status: nextStatus },
                {
                  onError: (err) =>
                    toast.error(
                      err instanceof ApiError
                        ? err.message
                        : "Could not update the ticket. Check the connection and try again.",
                    ),
                  onSuccess: (res) => {
                    if (res === null) toast.success("Saved on this phone - it will be sent when the connection is back");
                  },
                },
              )
            }
          >
            {updateStatus.isPending ? "Updating…" : STATUS_LABEL[ticket.status]}
          </Button>
        )}
        <div className="flex items-center gap-2">
        {canReject && (
          <Button
            variant="outline"
            className="h-10 min-w-0 flex-1 px-3 rounded-xl border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100/60 dark:hover:bg-rose-900/30 text-xs font-semibold active:scale-95 transition-transform"
            onClick={() => setRejectOpen(true)}
            aria-label={`Reject ticket for order ${ticket.order.orderNumber}`}
          >
            <X className="h-4 w-4 mr-1 stroke-[2.5]" aria-hidden />
            Reject
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl border-border/70 hover:bg-secondary/70 active:scale-95 transition-transform"
          title={ticket.isPriority ? "Unmark priority" : "Mark priority"}
          aria-label={ticket.isPriority ? "Unmark priority" : "Mark priority"}
          disabled={setPriority.isPending}
          onClick={() =>
            setPriority.mutate({ id: ticket.id, isPriority: !ticket.isPriority })
          }
        >
          <Star className={cn("h-4 w-4", ticket.isPriority ? "fill-amber-500 text-amber-500" : "text-muted-foreground")} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl border-border/70 hover:bg-secondary/70 active:scale-95 transition-transform"
          title={ticket.printedCount > 0 ? "Reprint ticket (marked REPRINT)" : "Print ticket"}
          aria-label={ticket.printedCount > 0 ? "Reprint ticket" : "Print ticket"}
          disabled={reprint.isPending}
          onClick={() =>
            reprint.mutate(
              { id: ticket.id, reprint: ticket.printedCount > 0 },
              {
                onSuccess: () =>
                  toast.success(
                    ticket.printedCount > 0 ? "Reprint sent to the kitchen printer" : "Ticket sent to the kitchen printer",
                  ),
                onError: (err) =>
                  toast.error(
                    err instanceof ApiError ? err.message : "Could not reach the server - printing needs the connection",
                  ),
              },
            )
          }
        >
          <Printer className="h-4 w-4 text-muted-foreground" />
        </Button>
        </div>
      </div>
    </Card>
  );
}
