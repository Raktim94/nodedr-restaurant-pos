"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { useCategories } from "@/hooks/use-menu";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const UNITS: IngredientUnit[] = ["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"];

/**
 * Creates a stock item without leaving the Stock Journal voucher. A finished product can also be put on the POS menu
 * right away; then the operator must type the selling price (tax-inclusive) and the tax rate, and choose the menu
 * category: none of these are guessed. The menu entry is linked to the stock item, so each sale deducts it.
 */
export function VoucherAddItemDialog({ branchId, kind, existing, open, onOpenChange, onCreated }: {
  branchId: string | null;
  kind: "PURCHASED" | "PREPARED";
  /** An existing finished product to put on the POS menu: no stock item is created, only the menu entry. */
  existing?: { id: string; name: string; unit: IngredientUnit };
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { data: categories } = useCategories(branchId);
  const finished = kind === "PREPARED";
  const [name, setName] = useState(existing?.name ?? "");
  const [unit, setUnit] = useState<IngredientUnit>(existing?.unit ?? (finished ? "PIECE" : "KG"));
  // A finished product is made to be sold, so it goes onto the POS menu unless the operator unticks this.
  const [onMenu, setOnMenu] = useState(!!existing || finished);
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [tax, setTax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Type the item name.");
    if (finished && onMenu) {
      if (!categoryId) return setError("Choose the menu category this item will appear under.");
      if (price.trim() === "" || !(Number(price) >= 0)) return setError("Type the selling price (tax included). It is not filled in for you.");
      if (tax.trim() === "" || !(Number(tax) >= 0) || Number(tax) > 100) return setError("Type the tax rate in percent (0 if none). It is not filled in for you.");
    }
    setBusy(true);
    let id = existing?.id ?? "";
    if (!existing) {
      try {
        const ing = await api.post<{ id: string }>(`/inventory/ingredients?branchId=${branchId}`, { name: name.trim(), unit, kind, reorderLevel: 0, isActive: true, conversions: [] });
        id = ing.id;
      } catch (err) {
        setBusy(false);
        return setError(err instanceof ApiError ? err.message : "Could not add the item. Nothing was saved.");
      }
    }
    if (finished && onMenu) {
      try {
        const m = await api.post<{ id: string }>(`/menu/items?branchId=${branchId}`, { categoryId, name: name.trim(), price: Number(price), taxRatePercent: Number(tax), isVeg: true });
        await api.patch(`/inventory/menu-items/${m.id}/tracking?branchId=${branchId}`, { inventoryTracking: "DIRECT", stockIngredientId: id, stockQuantityPerSale: 1 });
        void qc.invalidateQueries({ queryKey: ["menu"] });
      } catch (err) {
        // The stock item exists and is usable in the voucher; only the menu entry is missing.
        setBusy(false);
        onCreated(id);
        onOpenChange(false);
        toast.error(`${name.trim()} was added to stock, but not to the menu${err instanceof ApiError ? `: ${err.message}` : ""}. Add it under Menu.`);
        return;
      }
    }
    void qc.invalidateQueries({ queryKey: ["stock-items", branchId] });
    void qc.invalidateQueries({ queryKey: ["inventory", "ingredients", branchId] });
    setBusy(false);
    onCreated(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{existing ? `Put ${existing.name} on the POS menu` : finished ? "Add menu item" : "Add inventory item"}</DialogTitle>
            <DialogDescription>{existing ? "Adds a menu item that sells this stock item. Type the category, selling price and tax; nothing is filled in for you." : finished ? "Creates a finished product you can produce in this voucher, and by default puts it on the POS menu. Stock starts at zero." : "Creates a raw material (inventory item) for this voucher. It is not added to the menu. Stock starts at zero; receive it through a purchase first."}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5"><Label htmlFor="va-name">Name</Label><Input id="va-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required readOnly={!!existing} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="va-unit">Stock unit</Label>
            <SearchSelect id="va-unit" value={unit} disabled={!!existing} onChange={(v) => v && setUnit(v as IngredientUnit)} options={UNITS.map((u) => ({ value: u, label: u }))} />
          </div>
          {finished && (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              {!existing && <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={onMenu} onChange={(e) => setOnMenu(e.target.checked)} /> Also sell this on the POS menu</label>}
              {onMenu && (
                <>
                  <div className="flex flex-col gap-1.5"><Label htmlFor="va-cat">Menu category</Label>
                    <SearchSelect id="va-cat" value={categoryId} onChange={setCategoryId} placeholder="Choose a category" emptyText="No category matches" options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))} />
                    {categories?.length === 0 && <p className="text-xs text-destructive">There are no menu categories yet. Add one under Menu first.</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5"><Label htmlFor="va-price">Selling price (tax included)</Label><Input id="va-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required /></div>
                    <div className="flex flex-col gap-1.5"><Label htmlFor="va-tax">Tax rate %</Label><Input id="va-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="e.g. 5" required /></div>
                  </div>
                  <p className="text-xs text-muted-foreground">Each sale takes one {unit.toLowerCase()} out of this item&apos;s stock.</p>
                </>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Adding…" : existing ? "Put on POS menu" : finished ? "Add menu item" : "Add inventory item"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
