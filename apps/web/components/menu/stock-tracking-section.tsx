"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useIngredients,
  useRecipe,
  useSetRecipe,
  useSetTracking,
  useTracking,
  type InventoryTracking,
} from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

const MODES: { value: InventoryTracking; label: string; hint: string }[] = [
  { value: "NONE", label: "Not tracked", hint: "Selling it never changes stock." },
  { value: "RECIPE", label: "Recipe", hint: "Deducts the ingredients below for each one sold." },
  { value: "DIRECT", label: "Stock item", hint: "Deducts one stock item as-is (bottled drinks, packaged goods)." },
];

interface Line {
  ingredientId: string;
  quantity: string;
}

const selectClass =
  "h-10 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground";

// Lives under the item form; saves on its own because stock mapping is an
// inventory concern (needs inventory.manage) separate from the menu fields.
// The form mounts only once the saved mapping has loaded, so its initial state
// comes straight from props instead of being synced in an effect.
export function StockTrackingSection({ branchId, itemId, isCombo }: { branchId: string | null; itemId: string; isCombo: boolean }) {
  const { data: tracking } = useTracking(branchId, itemId);
  const { data: recipe } = useRecipe(branchId, itemId);
  if (isCombo) {
    return (
      <p className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground">
        Combos deduct stock through their component items. Set tracking on each component.
      </p>
    );
  }
  if (!tracking || !recipe) return null;
  return (
    <TrackingForm
      key={itemId}
      branchId={branchId}
      itemId={itemId}
      initialMode={tracking.inventoryTracking}
      initialDirectId={tracking.stockIngredientId ?? ""}
      initialDirectQty={String(tracking.stockQuantityPerSale)}
      initialLines={recipe.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) }))}
    />
  );
}

function TrackingForm({
  branchId,
  itemId,
  initialMode,
  initialDirectId,
  initialDirectQty,
  initialLines,
}: {
  branchId: string | null;
  itemId: string;
  initialMode: InventoryTracking;
  initialDirectId: string;
  initialDirectQty: string;
  initialLines: Line[];
}) {
  const { data: ingredients } = useIngredients(branchId);
  const setTracking = useSetTracking(branchId, itemId);
  const setRecipe = useSetRecipe(branchId, itemId);

  const [mode, setMode] = useState<InventoryTracking>(initialMode);
  const [directId, setDirectId] = useState(initialDirectId);
  const [directQty, setDirectQty] = useState(initialDirectQty);
  const [lines, setLines] = useState<Line[]>(initialLines);

  const unit = (id: string) => ingredients?.find((i) => i.id === id)?.unit.toLowerCase() ?? "";
  const incomplete =
    (mode === "DIRECT" && !directId) || (mode === "RECIPE" && lines.filter((l) => l.ingredientId).length === 0);

  const save = async () => {
    try {
      if (mode === "RECIPE") {
        const clean = lines
          .filter((l) => l.ingredientId && Number(l.quantity) > 0)
          .map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) }));
        await setRecipe.mutateAsync(clean);
        await setTracking.mutateAsync({ inventoryTracking: "RECIPE" });
      } else if (mode === "DIRECT") {
        await setTracking.mutateAsync({
          inventoryTracking: "DIRECT",
          stockIngredientId: directId,
          stockQuantityPerSale: Number(directQty) || 1,
        });
      } else {
        await setTracking.mutateAsync({ inventoryTracking: "NONE" });
      }
      toast.success("Stock tracking saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save stock tracking");
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-3" aria-label="Stock tracking">
      <div>
        <h3 className="text-sm font-medium text-foreground">Stock when sold</h3>
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === mode)?.hint}</p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Stock tracking mode">
        {MODES.map((m) => (
          <Button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            variant={mode === m.value ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(m.value)}
          >
            {m.label}
          </Button>
        ))}
      </div>

      {mode === "DIRECT" && (
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="direct-ingredient">Stock item</Label>
            <select id="direct-ingredient" className={selectClass} value={directId} onChange={(e) => setDirectId(e.target.value)}>
              <option value="">Choose…</option>
              {ingredients?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="direct-qty">Per sale {unit(directId) && `(${unit(directId)})`}</Label>
            <Input id="direct-qty" type="number" min="0.001" step="0.001" value={directQty} onChange={(e) => setDirectQty(e.target.value)} />
          </div>
        </div>
      )}

      {mode === "RECIPE" && (
        <div className="flex flex-col gap-2">
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_88px_40px] items-end gap-2">
              <select
                aria-label="Ingredient"
                className={selectClass}
                value={line.ingredientId}
                onChange={(e) => setLines(lines.map((l, i) => (i === idx ? { ...l, ingredientId: e.target.value } : l)))}
              >
                <option value="">Ingredient…</option>
                {ingredients?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Quantity ${unit(line.ingredientId)}`}
                type="number"
                min="0.001"
                step="0.001"
                value={line.quantity}
                onChange={(e) => setLines(lines.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))}
              />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove ingredient" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setLines([...lines, { ingredientId: "", quantity: "1" }])}>
            <Plus className="h-4 w-4" /> Add ingredient
          </Button>
        </div>
      )}

      {incomplete && <p className="text-xs text-warning">Choose the stock to deduct, otherwise selling this item deducts nothing.</p>}
      <Button type="button" size="sm" className="self-end" disabled={setTracking.isPending || setRecipe.isPending} onClick={save}>
        Save stock tracking
      </Button>
    </section>
  );
}
