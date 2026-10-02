"use client";

import { Check, MessageCircle, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChannelBadge, TypeBadge } from "@/components/orders/channel-badges";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcceptOrder, useCancelOrder, useOrder, useRejectOrder } from "@/hooks/use-orders";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  const cancel = useCancelOrder(branchId);
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
                        {item.quantity}× {item.name}
                      </span>
                      {item.modifiers.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {item.modifiers.map((m) => m.name).join(", ")}
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-foreground">
                      {formatCurrency(item.totalPrice)}
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

            {pending && (
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={accept.isPending}
                  onClick={() => run(() => accept.mutateAsync(order.id), "Order accepted — sent to the kitchen")}
                >
                  <Check className="mr-1.5 h-4 w-4" /> Accept order
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={reject.isPending}
                  onClick={() => run(() => reject.mutateAsync(order.id), "Order rejected")}
                >
                  <X className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </div>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                disabled={cancel.isPending}
                onClick={() => run(() => cancel.mutateAsync(order.id), "Order cancelled")}
              >
                <X className="mr-1.5 h-4 w-4" /> Cancel order
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
