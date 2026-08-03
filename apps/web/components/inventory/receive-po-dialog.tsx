"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateGoodsReceipt, type PurchaseOrderDetail } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

interface ReceiveRow {
  purchaseOrderItemId: string;
  ingredientId: string;
  name: string;
  unit: string;
  remaining: number;
  quantity: string;
  unitCost: string;
  expiryDate: string;
}

export function ReceivePoDialog({ branchId, po }: { branchId: string | null; po: PurchaseOrderDetail }) {
  const [open, setOpen] = useState(false);
  const outstanding = po.items.filter(
    (item) => Number(item.quantityReceived) < Number(item.quantityOrdered),
  );
  const [rows, setRows] = useState<ReceiveRow[]>(() =>
    outstanding.map((item) => ({
      purchaseOrderItemId: item.id,
      ingredientId: item.ingredientId,
      name: item.ingredient?.name ?? item.ingredientId,
      unit: item.ingredient?.unit ?? "",
      remaining: Number(item.quantityOrdered) - Number(item.quantityReceived),
      quantity: String(Number(item.quantityOrdered) - Number(item.quantityReceived)),
      unitCost: item.unitCost,
      expiryDate: "",
    })),
  );
  const createGrn = useCreateGoodsReceipt(branchId);

  const updateRow = (index: number, patch: Partial<ReceiveRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const activeRows = rows.filter((r) => Number(r.quantity) > 0);
  const canSubmit = activeRows.length > 0 && activeRows.every((r) => Number(r.unitCost) >= 0);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createGrn.mutate(
      {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        items: activeRows.map((r) => ({
          ingredientId: r.ingredientId,
          purchaseOrderItemId: r.purchaseOrderItemId,
          quantity: Number(r.quantity),
          unitCost: Number(r.unitCost),
          expiryDate: r.expiryDate ? new Date(r.expiryDate) : undefined,
        })),
      },
      {
        onSuccess: () => {
          toast.success("Goods receipt recorded — stock updated");
          setOpen(false);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not record goods receipt"),
      },
    );
  };

  if (outstanding.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Receive items</Button>} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Receive against {po.poNumber}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Enter what actually arrived — quantity and cost can differ from what was ordered.
            Each line becomes its own batch with a lot number and optional expiry date.
          </p>
          <div className="flex flex-col gap-4">
            {rows.map((row, index) => (
              <div key={row.purchaseOrderItemId} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between text-sm font-medium text-foreground">
                  <span>{row.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.remaining} {row.unit} outstanding
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Qty received</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={row.quantity}
                      onChange={(e) => updateRow(index, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Cost / unit</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.unitCost}
                      onChange={(e) => updateRow(index, { unitCost: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Expiry (optional)</Label>
                    <Input
                      type="date"
                      value={row.expiryDate}
                      onChange={(e) => updateRow(index, { expiryDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || createGrn.isPending}>
              {createGrn.isPending ? "Recording…" : "Record goods receipt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
