"use client";

import { CheckoutPanel } from "@/components/pos/checkout-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenOrdersForTable } from "@/hooks/use-orders";
import type { RestaurantTable } from "@/hooks/use-tables";

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
  const order = orders?.[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bill {table.name ?? `Table ${table.number}`}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !order ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No open order found for this table.
          </p>
        ) : (
          <CheckoutPanel
            order={order}
            branchId={branchId}
            customer={order.customer}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
