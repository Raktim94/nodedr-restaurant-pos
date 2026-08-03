"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { WasteReason } from "@nodedr-restaurant/types";
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
import { useIngredients, useLogWaste } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

const REASONS: { value: WasteReason; label: string }[] = [
  { value: "EXPIRED", label: "Expired" },
  { value: "SPOILED", label: "Spoiled" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "PREP_ERROR", label: "Prep error" },
  { value: "OVER_PRODUCTION", label: "Over-production" },
  { value: "OTHER", label: "Other" },
];

export function LogWasteDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<WasteReason>("SPOILED");
  const [notes, setNotes] = useState("");
  const { data: ingredients } = useIngredients(branchId);
  const logWaste = useLogWaste(branchId);

  const selected = ingredients?.find((i) => i.id === ingredientId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingredientId || !Number(quantity)) return;
    logWaste.mutate(
      { ingredientId, quantity: Number(quantity), reason, notes: notes || undefined },
      {
        onSuccess: () => {
          toast.success("Waste logged and stock updated");
          setOpen(false);
          setIngredientId("");
          setQuantity("");
          setNotes("");
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not log waste"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Log waste</Button>} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Log waste</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label>Ingredient</Label>
            <Select value={ingredientId} onValueChange={(v) => setIngredientId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select an ingredient" />
              </SelectTrigger>
              <SelectContent>
                {ingredients?.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} ({i.currentStock} {i.unit} in stock)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="w-qty">Quantity{selected ? ` (${selected.unit})` : ""}</Label>
            <Input
              id="w-qty"
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as WasteReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="w-notes">Notes (optional)</Label>
            <Input id="w-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={logWaste.isPending}>
              {logWaste.isPending ? "Logging…" : "Log waste"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
