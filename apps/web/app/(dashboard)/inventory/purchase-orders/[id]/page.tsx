"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { toast } from "sonner";
import { ReceivePoDialog } from "@/components/inventory/receive-po-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import {
  usePurchaseOrder,
  useUpdatePurchaseOrderStatus,
  type PurchaseOrderDetail,
} from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { branchId } = useBranch();
  const { data: po, isLoading } = usePurchaseOrder(branchId, id);
  const updateStatus = useUpdatePurchaseOrderStatus(branchId);

  if (isLoading || !po) {
    return <Skeleton className="h-96 rounded-2xl" />;
  }

  const send = () =>
    updateStatus.mutate(
      { id: po.id, status: "SENT" },
      {
        onSuccess: () => toast.success("Marked as sent to supplier"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update"),
      },
    );

  const cancel = () =>
    updateStatus.mutate(
      { id: po.id, status: "CANCELLED" },
      {
        onSuccess: () => toast.success("Purchase order cancelled"),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update"),
      },
    );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/inventory/purchase-orders"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Purchase orders
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{po.poNumber}</h1>
          <Badge>{po.status.replace("_", " ")}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {po.supplier.name} · created by {po.createdBy.name} on{" "}
          {new Date(po.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {po.status === "DRAFT" && (
          <Button size="sm" onClick={send} disabled={updateStatus.isPending}>
            Mark as sent
          </Button>
        )}
        {(po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") && (
          <ReceivePoDialog branchId={branchId} po={po} />
        )}
        {(po.status === "DRAFT" || po.status === "SENT") && (
          <Button size="sm" variant="outline" onClick={cancel} disabled={updateStatus.isPending}>
            Cancel order
          </Button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Cost / unit</TableHead>
              <TableHead className="text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-foreground">
                  {item.ingredient?.name ?? item.ingredientId}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantityOrdered} {item.ingredient?.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantityReceived} {item.ingredient?.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(item.unitCost)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(Number(item.quantityOrdered) * Number(item.unitCost))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold text-foreground">{formatCurrency(po.totalAmount)}</span>
        </div>
      </Card>

      {po.goodsReceipts.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[18px] font-medium text-foreground">Goods receipts</h2>
          <div className="flex flex-col divide-y divide-border">
            {po.goodsReceipts.map((grn: PurchaseOrderDetail["goodsReceipts"][number]) => (
              <div key={grn.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{grn.grnNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    Received by {grn.receivedBy.name} on {new Date(grn.receivedAt).toLocaleDateString()}
                  </span>
                </div>
                <span className="text-muted-foreground">{grn.items.length} line item(s)</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
