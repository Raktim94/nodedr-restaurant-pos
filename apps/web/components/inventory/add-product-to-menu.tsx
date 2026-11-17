"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCategories } from "@/hooks/use-menu";
import type { Ingredient } from "@/hooks/use-inventory";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Explicitly create a sellable menu item and link it to the finished stock item. */
export function AddProductToMenu({ branchId, product, onClose }: { branchId: string | null; product: Pick<Ingredient, "id" | "name" | "unit"> | null; onClose: () => void }) {
  const { data: categories = [] } = useCategories(branchId);
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [tax, setTax] = useState("");
  const [qty, setQty] = useState("1");
  const [foodType, setFoodType] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product || !branchId || !category || price.trim() === "" || !Number.isFinite(Number(price)) || Number(price) < 0 || tax.trim() === "" || !Number.isFinite(Number(tax)) || Number(tax) < 0 || Number(tax) > 100 || !foodType || !(Number(qty) > 0)) {
      setError("Choose a category and enter a valid price, tax rate, and stock quantity per sale.");
      return;
    }
    setBusy(true); setError("");
    let id = itemId;
    try {
      if (!id) {
        const created = await api.post<{ id: string }>(`/menu/items?branchId=${branchId}`, {
          name: product.name, categoryId: category, price: Number(price), taxRatePercent: Number(tax),
          isVeg: foodType === "veg", isVegan: false, isJain: false, isHalal: false, isGlutenFree: false,
          spiceLevel: "NONE", allergens: [], isActive: false, modifierGroupIds: [],
        });
        id = created.id;
        setItemId(id);
        void qc.invalidateQueries({ queryKey: ["menu", "items", branchId] });
      }
      await api.patch(`/inventory/menu-items/${id}/tracking?branchId=${branchId}`, {
        inventoryTracking: "DIRECT", stockIngredientId: product.id, stockQuantityPerSale: Number(qty),
      });
      await api.patch(`/menu/items/${id}?branchId=${branchId}`, { isActive: true });
      void qc.invalidateQueries({ queryKey: ["menu", "items", branchId] });
      void qc.invalidateQueries({ queryKey: ["inventory", "tracking"] });
      onClose();
    } catch (err) {
      setError(`${id ? "The menu item was created but setup did not finish. Retry or finish in Menu settings. " : ""}${err instanceof ApiError ? err.message : "Could not save the menu item."}`);
    } finally { setBusy(false); }
  }

  return <Dialog open={!!product} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Add {product?.name} to the menu?</DialogTitle><DialogDescription>Optional: make this finished product available for sale. Each sale deducts the quantity you choose below.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-1"><Label htmlFor="product-menu-category">Menu category</Label><select id="product-menu-category" className="h-10 rounded-md border border-input bg-background px-2" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!!itemId} required><option value="">Choose a category</option>{categories.filter((c) => c.isActive).map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select>{categories.length === 0 && <p className="text-xs text-muted-foreground">Create a category in Menu first.</p>}</div>
        <div className="grid grid-cols-2 gap-3"><div className="grid gap-1"><Label htmlFor="product-menu-price">Selling price</Label><Input id="product-menu-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} disabled={!!itemId} required /></div><div className="grid gap-1"><Label htmlFor="product-menu-tax">Tax %</Label><Input id="product-menu-tax" type="number" min="0" max="100" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} disabled={!!itemId} required /></div></div>
        <div className="grid gap-1"><Label htmlFor="product-menu-diet">Food type</Label><select id="product-menu-diet" className="h-10 rounded-md border border-input bg-background px-2" value={foodType} onChange={(e) => setFoodType(e.target.value)} disabled={!!itemId} required><option value="">Choose a food type</option><option value="veg">Vegetarian</option><option value="nonveg">Non-vegetarian</option></select></div>
        <div className="grid gap-1"><Label htmlFor="product-menu-qty">Stock used per sale ({product?.unit.toLowerCase()})</Label><Input id="product-menu-qty" type="number" min="0.001" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} required /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{itemId ? "Finish later" : "Skip"}</Button><Button type="submit" disabled={busy || !categories.length}>{busy ? "Saving…" : itemId ? "Retry stock link" : "Add to menu"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
