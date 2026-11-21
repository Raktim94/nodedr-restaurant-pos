"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
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

export interface StockTrackingHandle {
  save: () => Promise<boolean>;
}

export function StockTrackingSection({
  branchId,
  itemId,
  itemName,
  isCombo,
  onHandleReady,
}: {
  branchId: string | null;
  itemId: string;
  itemName?: string;
  isCombo: boolean;
  onHandleReady?: (handle: StockTrackingHandle) => void;
}) {
  const { data: tracking } = useTracking(branchId, itemId);
  const { data: recipe } = useRecipe(branchId, itemId);

  if (isCombo) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 text-xs text-muted-foreground">
        Combos deduct stock through their component items. Tracking is configured on individual component items.
      </div>
    );
  }

  if (!tracking || !recipe) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-muted-foreground animate-pulse">
        Loading inventory stock rules…
      </div>
    );
  }

  return (
    <TrackingForm
      key={itemId}
      branchId={branchId}
      itemId={itemId}
      itemName={itemName}
      initialMode={tracking.inventoryTracking}
      initialDirectId={tracking.stockIngredientId ?? ""}
      initialDirectQty={String(tracking.stockQuantityPerSale || 1)}
      initialLines={recipe.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) }))}
      onHandleReady={onHandleReady}
    />
  );
}

function TrackingForm({
  branchId,
  itemId,
  itemName,
  initialMode,
  initialDirectId,
  initialDirectQty,
  initialLines,
  onHandleReady,
}: {
  branchId: string | null;
  itemId: string;
  itemName?: string;
  initialMode: InventoryTracking;
  initialDirectId: string;
  initialDirectQty: string;
  initialLines: Line[];
  onHandleReady?: (handle: StockTrackingHandle) => void;
}) {
  const { data: ingredients } = useIngredients(branchId);
  const setTracking = useSetTracking(branchId, itemId);
  const setRecipe = useSetRecipe(branchId, itemId);

  const [mode, setMode] = useState<InventoryTracking>(initialMode);
  const [directId, setDirectId] = useState(initialDirectId);
  const [directQty, setDirectQty] = useState(initialDirectQty);
  const [lines, setLines] = useState<Line[]>(initialLines);

  // Auto-match ingredient on switching to DIRECT if not already selected
  const handleModeChange = (newMode: InventoryTracking) => {
    setMode(newMode);
    if (newMode === "DIRECT" && !directId && ingredients?.length && itemName) {
      const cleanTarget = itemName.trim().toLowerCase();
      const match = ingredients.find((i) => {
        const ing = i.name.trim().toLowerCase();
        return ing === cleanTarget || ing.includes(cleanTarget) || cleanTarget.includes(ing);
      });
      if (match) {
        setDirectId(match.id);
        if (!directQty || Number(directQty) <= 0) setDirectQty("1");
      }
    }
  };

  const unit = (id: string) => ingredients?.find((i) => i.id === id)?.unit.toLowerCase() ?? "";

  const performSave = async (): Promise<boolean> => {
    try {
      if (mode === "RECIPE") {
        // Validate recipe lines: require valid ingredient and positive quantity
        for (const l of lines) {
          if (!l.ingredientId) continue;
          if (!(Number(l.quantity) > 0)) {
            toast.error("Please enter a valid positive quantity for all selected recipe ingredients.");
            return false;
          }
        }

        const merged = new Map<string, number>();
        for (const l of lines) {
          if (!l.ingredientId) continue;
          merged.set(l.ingredientId, (merged.get(l.ingredientId) ?? 0) + Number(l.quantity));
        }
        const clean = Array.from(merged.entries()).map(([ingredientId, quantity]) => ({
          ingredientId,
          quantity,
        }));
        await setRecipe.mutateAsync(clean);
        await setTracking.mutateAsync({ inventoryTracking: "RECIPE" });
      } else if (mode === "DIRECT") {
        await setTracking.mutateAsync({
          inventoryTracking: "DIRECT",
          stockIngredientId: directId || null,
          stockQuantityPerSale: Number(directQty) || 1,
        });
      } else {
        await setTracking.mutateAsync({ inventoryTracking: "NONE" });
      }
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save inventory tracking");
      return false;
    }
  };

  // Always keep a fresh ref to performSave so parent dialog calls the latest state
  const performSaveRef = useRef(performSave);
  useEffect(() => {
    performSaveRef.current = performSave;
  });

  useEffect(() => {
    if (onHandleReady) {
      onHandleReady({ save: () => performSaveRef.current() });
    }
  }, [onHandleReady]);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-4 shadow-2xs" aria-label="Stock tracking">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inventory & Stock Tracking</h3>
          <p className="text-xs text-muted-foreground/90 mt-0.5">{MODES.find((m) => m.value === mode)?.hint}</p>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
          Auto-deduct on sale
        </span>
      </div>

      {/* Apple HIG Segmented Control */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1 border border-border/50" role="radiogroup">
        {MODES.map((m) => {
          const isActive = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => handleModeChange(m.value)}
              className={cn(
                "h-8 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center justify-center",
                isActive
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {mode === "DIRECT" && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2.5 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="direct-ingredient" className="text-xs font-medium text-foreground">Stock item to deduct</Label>
            <select
              id="direct-ingredient"
              className="h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-xs sm:text-sm text-foreground focus:ring-1 focus:ring-primary outline-none transition-all cursor-pointer"
              value={directId}
              onChange={(e) => setDirectId(e.target.value)}
            >
              <option value="">Choose stock item…</option>
              {ingredients?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit}) — Current Stock: {Number(i.currentStock)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="direct-qty" className="text-xs font-medium text-foreground">
              Deduct Qty {unit(directId) && `(${unit(directId)})`}
            </Label>
            <Input
              id="direct-qty"
              type="number"
              min="0.001"
              step="0.001"
              value={directQty}
              onChange={(e) => setDirectQty(e.target.value)}
              className="rounded-xl h-10 text-xs sm:text-sm"
              placeholder="1"
            />
          </div>
        </div>
      )}

      {mode === "RECIPE" && (
        <div className="flex flex-col gap-2 pt-1">
          <Label className="text-xs font-medium text-foreground">Recipe Ingredients (Bill of Materials)</Label>
          <div className="flex flex-col gap-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_96px_36px] items-center gap-2">
                <select
                  aria-label="Ingredient"
                  className="h-9 w-full rounded-xl border border-border/70 bg-background px-2.5 text-xs text-foreground focus:ring-1 focus:ring-primary outline-none cursor-pointer"
                  value={line.ingredientId}
                  onChange={(e) => setLines(lines.map((l, i) => (i === idx ? { ...l, ingredientId: e.target.value } : l)))}
                >
                  <option value="">Select ingredient…</option>
                  {ingredients?.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
                </select>
                <div className="relative flex items-center">
                  <Input
                    aria-label={`Quantity ${unit(line.ingredientId)}`}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.quantity}
                    onChange={(e) => setLines(lines.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))}
                    className="rounded-xl h-9 text-xs pr-6"
                    placeholder="Qty"
                  />
                  {unit(line.ingredientId) && (
                    <span className="absolute right-2 text-[10px] text-muted-foreground pointer-events-none uppercase font-semibold">
                      {unit(line.ingredientId)}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                  aria-label="Remove ingredient"
                  onClick={() => setLines(lines.filter((_, i) => i !== idx))}
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
            className="self-start rounded-xl h-8 px-3 text-xs gap-1.5 mt-1 border-dashed text-primary hover:bg-primary/5 hover:border-primary/60 cursor-pointer"
            onClick={() => setLines([...lines, { ingredientId: "", quantity: "0.1" }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add ingredient line
          </Button>
        </div>
      )}

      {mode === "DIRECT" && !directId && (
        <p className="text-[11px] text-amber-500 font-medium bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
          ⚠️ Please select the stock item to deduct on checkout.
        </p>
      )}
      {mode === "RECIPE" && lines.filter((l) => l.ingredientId).length === 0 && (
        <p className="text-[11px] text-amber-500 font-medium bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
          ⚠️ Add at least one ingredient line so recipe stock is deducted when ordered.
        </p>
      )}
    </section>
  );
}
