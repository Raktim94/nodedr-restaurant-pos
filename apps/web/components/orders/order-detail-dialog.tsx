"use client";

import { MessageCircle, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrder } from "@/hooks/use-orders";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const ONLINE_ORDER_TYPES = new Set(["QR_ORDER", "KIOSK"]);

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
  const isOnline = order ? ONLINE_ORDER_TYPES.has(order.type) : false;
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
            {order && (
              <Badge
                variant="secondary"
                className={cn(
                  "font-normal",
                  isOnline ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
                )}
              >
                {isOnline ? "Online" : "Offline"}
              </Badge>
            )}
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
              <Badge variant="secondary" className="font-normal">
                {order.type.replace("_", " ")}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {order.status}
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
              <span className="text-foreground">{order.customer?.name ?? "Walk-in guest"}</span>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
