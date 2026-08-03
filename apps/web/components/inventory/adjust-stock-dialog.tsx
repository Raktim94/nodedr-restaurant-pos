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
import { useAdjustStock, type Ingredient } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

export function AdjustStockDialog({
  branchId,
  ingredient,
}: {
  branchId: string | null;
  ingredient: Ingredient;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const adjustStock = useAdjustStock(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(quantity);
    if (!qty || !note.trim()) return;
    adjustStock.mutate(
      { id: ingredient.id, dto: { quantity: qty, note } },
      {
        onSuccess: () => {
          toast.success(`Stock adjusted by ${qty > 0 ? "+" : ""}${qty} ${ingredient.unit}`);
          setOpen(false);
          setQuantity("");
          setNote("");
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not adjust stock"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Adjust</Button>} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Adjust stock — {ingredient.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Current: {ingredient.currentStock} {ingredient.unit}. Use this only for stocktake
            corrections — receiving stock should go through a purchase order + GRN, and losses
            should go through the waste log.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adj-qty">Quantity change</Label>
            <Input
              id="adj-qty"
              type="number"
              step="0.001"
              placeholder="e.g. -2 or 5"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="adj-note">Reason</Label>
            <Input
              id="adj-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Physical count correction"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={adjustStock.isPending}>
              {adjustStock.isPending ? "Saving…" : "Save adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
