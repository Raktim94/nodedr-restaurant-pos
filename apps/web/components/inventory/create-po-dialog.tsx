"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIngredients, useCreatePurchaseOrder, useSuppliers } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

interface Row {
  ingredientId: string;
  quantityOrdered: string;
  unitCost: string;
}

const emptyRow: Row = { ingredientId: "", quantityOrdered: "", unitCost: "" };

export function CreatePoDialog({ branchId }: { branchId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);
  const { data: suppliers } = useSuppliers(branchId);
  const { data: ingredients } = useIngredients(branchId);
  const createPo = useCreatePurchaseOrder(branchId);

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const total = rows.reduce(
    (sum, r) => sum + (Number(r.quantityOrdered) || 0) * (Number(r.unitCost) || 0),
    0,
  );

  const canSubmit =
    !!supplierId &&
    rows.length > 0 &&
    rows.every((r) => r.ingredientId && Number(r.quantityOrdered) > 0 && Number(r.unitCost) >= 0);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createPo.mutate(
      {
        supplierId,
        items: rows.map((r) => ({
          ingredientId: r.ingredientId,
          quantityOrdered: Number(r.quantityOrdered),
          unitCost: Number(r.unitCost),
        })),
      },
      {
        onSuccess: (po) => {
          toast.success(`${po.poNumber} created`);
          setOpen(false);
          setSupplierId("");
          setRows([{ ...emptyRow }]);
          router.push(`/inventory/purchase-orders/${po.id}`);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not create purchase order"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New purchase order</Button>} />
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={(v) => setSupplierId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select a supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Items</Label>
            <div className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={row.ingredientId}
                    onValueChange={(v) => updateRow(index, { ingredientId: v ?? "" })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Ingredient" />
                    </SelectTrigger>
                    <SelectContent>
                      {ingredients?.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} ({i.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="Qty"
                    className="w-20"
                    value={row.quantityOrdered}
                    onChange={(e) => updateRow(index, { quantityOrdered: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Cost/unit"
                    className="w-24"
                    value={row.unitCost}
                    onChange={(e) => updateRow(index, { unitCost: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={rows.length === 1}
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1"
              onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
            >
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || createPo.isPending}>
              {createPo.isPending ? "Creating…" : "Create purchase order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
