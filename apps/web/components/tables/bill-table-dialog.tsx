"use client";

import { useState } from "react";
import { CheckoutPanel } from "@/components/pos/checkout-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenOrdersForTable } from "@/hooks/use-orders";
import type { RestaurantTable } from "@/hooks/use-tables";
import { formatCurrency } from "@/lib/format";

export function BillTableDialog({
  branchId,
  table,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  table: RestaurantTable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: orders, isLoading } = useOpenOrdersForTable(branchId, open ? table.id : null);
  // A table can hold several open bills (split guests, separate rounds). Never pick one silently: with more
  // than one open, the cashier chooses which bill this payment settles.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const order =
    orders && orders.length === 1
      ? orders[0]
      : orders?.find((o) => o.id === chosenId);
  const mustChoose = !!orders && orders.length > 1 && !order;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setChosenId(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bill {table.name ?? `Table ${table.number}`}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : mustChoose ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              This table has {orders?.length} open bills. Choose the one to settle.
            </p>
            {orders?.map((o) => (
              <Button
                key={o.id}
                type="button"
                variant="outline"
                className="h-auto justify-between gap-3 py-3 text-left"
                onClick={() => setChosenId(o.id)}
              >
                <span className="flex flex-col">
                  <span className="font-medium">Order #{o.orderNumber}</span>
                  <span className="text-xs text-muted-foreground">{o.customer?.name ?? "No customer"}</span>
                </span>
                <span className="font-semibold">{formatCurrency(o.totalAmount)}</span>
              </Button>
            ))}
          </div>
        ) : !order ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No open order found for this table.
          </p>
        ) : (
          <CheckoutPanel
            key={order.id}
            order={order}
            branchId={branchId}
            initialCustomer={order.customer}
            onDone={() => {
              onOpenChange(false);
              setChosenId(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
