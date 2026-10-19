"use client";

import { Check, MessageCircle, Pencil, Phone, X } from "lucide-react";
import { useState } from "react";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChannelBadge, TypeBadge } from "@/components/orders/channel-badges";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CancelOrderDialog, useCanCancelOrders } from "@/components/orders/cancel-order-dialog";
import { EditBillDialog } from "@/components/orders/edit-bill-dialog";
import { ReasonDialog } from "@/components/orders/reason-dialog";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useAcceptOrder, useOrder, useRejectOrder } from "@/hooks/use-orders";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const CANCEL_SOURCE_LABEL = {
  STAFF: "Cancelled by staff",
  CUSTOMER: "Cancelled at the guest's request",
  KITCHEN_REJECTED: "Rejected by the kitchen",
  ONLINE_DECLINED: "Declined when it came in",
} as const;

export function OrderDetailDialog({
  branchId,
  orderId,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: order, isLoading } = useOrder(branchId, open ? orderId : null);
  const accept = useAcceptOrder(branchId);
  const reject = useRejectOrder(branchId);
  const { note, clear: clearNote, toast } = useNoteToast();
  const canCancelRole = useCanCancelOrders();
  const { data: me } = useCurrentUser();
  const canEditRole = hasPermission(me?.user, "orders.edit");
  const canAnswer = hasPermission(me?.user, "orders.accept");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const customerName = order?.guestName ?? order?.customer?.name ?? "Walk-in guest";
  const pending = order?.status === "OPEN" && order?.acceptance === "PENDING";
  const canCancel = order?.status === "OPEN" && !pending;
  const run = (fn: () => Promise<unknown>, done: string) =>
    fn().then(
      () => {
        toast.success(done);
        onOpenChange(false);
      },
      (err: unknown) => toast.error(err instanceof Error ? err.message : "Something went wrong"),
    );
  const phone = order?.customer?.phone ?? null;
  const waHref = phone
    ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
        `Hi, this is regarding your order #${order?.orderNumber}.`,
      )}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order ? `Order #${order.orderNumber}` : "Order details"}
            {order && <ChannelBadge channel={order.channel} />}
          </DialogTitle>
        </DialogHeader>
        <StatusNote note={note} onClear={clearNote} />

        {isLoading || !order ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <TypeBadge type={order.type} />
              <Badge variant="secondary" className="font-normal">
                {pending ? "Awaiting acceptance" : order.acceptance === "REJECTED" ? "Rejected" : order.status}
              </Badge>
              {order.table && (
                <span>Table {order.table.name ?? order.table.number}</span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Items
              </div>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">
                        {item.quantity}× {item.nameSnapshot}
                      </span>
                      {item.modifiers.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {item.modifiers.map((m) => m.nameSnapshot).join(", ")}
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(item.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-lg bg-secondary/40 px-3 py-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatCurrency(order.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Tax</span>
                <span className="tabular-nums">{formatCurrency(order.taxAmount)}</span>
              </div>
              <div className="flex items-center justify-between font-medium text-foreground">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(order.totalAmount)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Customer
              </div>
              <span className="font-medium text-foreground">{customerName}</span>
              {phone ? (
                <>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" /> {phone}
                  </span>
                  <div className="flex gap-2">
                    <a href={`tel:${phone}`} className={cn(buttonVariants({ size: "sm" }), "flex-1")}>
                      <Phone className="mr-1.5 h-4 w-4" /> Call
                    </a>
                    <a
                      href={waHref ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" /> WhatsApp
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No phone number on file.</p>
              )}
            </div>

            {order.notes && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                Note: {order.notes}
              </p>
            )}

            {pending && canAnswer && (
              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  disabled={accept.isPending}
                  onClick={() => run(() => accept.mutateAsync(order.id), "Order accepted — sent to the kitchen")}
                >
                  <Check className="mr-1.5 h-4 w-4" /> Accept order
                </Button>
                <Button variant="destructive" className="h-11 flex-1" onClick={() => setDeclineOpen(true)}>
                  <X className="mr-1.5 h-4 w-4" /> Decline
                </Button>
              </div>
            )}
            {pending && !canAnswer && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                Waiting for someone with permission to accept or decline orders.
              </p>
            )}
            {order.status === "CANCELLED" && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                {CANCEL_SOURCE_LABEL[order.cancelSource ?? "STAFF"]}
                {order.cancelReason ? `: ${order.cancelReason}` : ""}
              </p>
            )}
            {order.status === "PAID" && (
              <p className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                This bill is paid. To correct it, issue a refund from the Dashboard — paid bills are never edited in place.
              </p>
            )}
            {canCancel && (
              <div className="flex gap-2">
                {canEditRole && (
                  <Button variant="outline" className="flex-1" onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-1.5 h-4 w-4" /> Edit bill
                  </Button>
                )}
                {canCancelRole ? (
                  <Button variant="destructive" className="flex-1" onClick={() => setCancelOpen(true)}>
                    <X className="mr-1.5 h-4 w-4" /> Cancel order
                  </Button>
                ) : (
                  <p className="flex-1 self-center text-xs text-muted-foreground">
                    Cancelling needs a manager — ask one to cancel this order.
                  </p>
                )}
              </div>
            )}
            {order && (
              <>
                <CancelOrderDialog
                  branchId={branchId}
                  orderId={order.id}
                  orderNumber={order.orderNumber}
                  open={cancelOpen}
                  onOpenChange={setCancelOpen}
                  />
                <EditBillDialog branchId={branchId} orderId={order.id} open={editOpen} onOpenChange={setEditOpen} />
                <ReasonDialog
                  open={declineOpen}
                  onOpenChange={setDeclineOpen}
                  title={`Decline order #${order.orderNumber}?`}
                  description="The guest's order is not made. It stays in History with your reason and name, and nothing is charged."
                  reasons={["Closing soon", "Out of stock", "Too busy", "Outside delivery area"]}
                  confirmLabel="Decline order"
                  keepLabel="Go back"
                  onSubmit={(reason) =>
                    reject.mutateAsync({ orderId: order.id, reason }).then(() => {
                      toast.success("Order declined");
                      onOpenChange(false);
                    })
                  }
                />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
