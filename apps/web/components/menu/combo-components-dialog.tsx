"use client";

import { Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useComboComponents, useSetComboComponents, type ComboComponent } from "@/hooks/use-combos";
import type { MenuItem } from "@/hooks/use-menu";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

interface Row {
  componentItemId: string;
  quantity: number;
}

// Keyed by item.id from the parent and only mounted once `existing` has
// loaded — so `rows`'s initial state can come from a lazy useState
// initializer (a pure, one-time read of already-available data) instead of
// an effect + setState, same pattern as ModifierPickerDialog.
function ComboRowsEditor({
  item,
  candidates,
  existing,
  branchId,
  onSaved,
}: {
  item: MenuItem;
  candidates: MenuItem[];
  existing: ComboComponent[];
  branchId: string | null;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    existing.map((c) => ({ componentItemId: c.componentItemId, quantity: c.quantity })),
  );
  const setComponents = useSetComboComponents(branchId, item.id);

  const addRow = () => {
    const firstAvailable = candidates.find((c) => !rows.some((r) => r.componentItemId === c.id));
    if (!firstAvailable) return;
    setRows((prev) => [...prev, { componentItemId: firstAvailable.id, quantity: 1 }]);
  };

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    setComponents.mutate(
      { components: rows },
      {
        onSuccess: () => {
          toast.success(`Combo components saved for ${item.name}`);
          onSaved();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not save combo components"),
      },
    );
  };

  return (
    <>
      <div className="flex flex-col gap-3 py-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No components yet — this item sells as a regular menu item. Add components to make it
            a combo.
          </p>
        )}
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={row.componentItemId}
              onValueChange={(v) => v && updateRow(index, { componentItemId: v })}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({formatCurrency(c.price)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => updateRow(index, { quantity: Math.max(1, row.quantity - 1) })}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="w-5 text-center text-sm tabular-nums">{row.quantity}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => updateRow(index, { quantity: row.quantity + 1 })}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(index)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={rows.length >= candidates.length}
          onClick={addRow}
        >
          Add component
        </Button>
      </div>

      <DialogFooter>
        <Button disabled={setComponents.isPending} onClick={handleSave}>
          {setComponents.isPending ? "Saving…" : "Save combo"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function ComboComponentsDialog({
  branchId,
  item,
  allItems,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  item: MenuItem | null;
  allItems: MenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: existing } = useComboComponents(branchId, item?.id ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item?.name} — combo components</DialogTitle>
        </DialogHeader>

        {item && existing ? (
          <ComboRowsEditor
            key={item.id}
            item={item}
            candidates={allItems.filter((i) => i.id !== item.id)}
            existing={existing}
            branchId={branchId}
            onSaved={() => onOpenChange(false)}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
