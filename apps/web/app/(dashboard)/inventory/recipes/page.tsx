"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { type Recipe, useRecipeMutations, useRecipes } from "@/hooks/use-manufacturing";
import { useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

interface Row { key: number; ingredientId: string; quantity: string; unit: IngredientUnit | "" }
let k = 1;

// Saved bills of materials: what a base output quantity of a finished product takes. A voucher copies the recipe it
// used, so editing one here (which bumps its version) never rewrites a batch already posted.
export default function RecipesPage() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canEdit = hasPermission(me?.user, "inventory.manage");
  const { data: recipes } = useRecipes(branchId, undefined, true);
  const { data: items } = useStockItems(branchId);
  const m = useRecipeMutations(branchId);
  const [edit, setEdit] = useState<Recipe | "new" | null>(null);
  const [product, setProduct] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: k++, ingredientId: "", quantity: "", unit: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const products = (items ?? []).filter((i) => i.kind === "PREPARED");
  const raw = (items ?? []).filter((i) => i.kind === "PURCHASED");

  const open = (r: Recipe | "new") => {
    setErr(null);
    setEdit(r);
    if (r === "new") { setProduct(""); setName(""); setBase(""); setNotes(""); setRows([{ key: k++, ingredientId: "", quantity: "", unit: "" }]); }
    else { setProduct(r.outputIngredientId); setName(r.name); setBase(r.baseOutputQty); setNotes(r.notes ?? ""); setRows(r.lines.map((l) => ({ key: k++, ingredientId: l.ingredientId, quantity: l.quantity, unit: l.unit }))); }
  };
  const used = rows.filter((r) => r.ingredientId || r.quantity);
  const save = () => {
    if (!product || !name.trim() || !(Number(base) > 0) || !used.length || used.some((r) => !r.ingredientId || !(Number(r.quantity) > 0))) return setErr("Choose the product, name the recipe, give a base output above zero, and a quantity for every ingredient.");
    const body = { outputIngredientId: product, name: name.trim(), baseOutputQty: base.trim(), notes: notes.trim() || undefined, lines: used.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: (r.unit || byId.get(r.ingredientId)?.unit) as IngredientUnit })) };
    const done = () => { toast.success("Recipe saved"); setEdit(null); };
    const onError = (e: unknown) => setErr(e instanceof ApiError ? e.message : "Could not save");
    if (edit === "new") m.create.mutate(body, { onSuccess: done, onError });
    else if (edit) m.update.mutate({ id: edit.id, body }, { onSuccess: done, onError });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        {canEdit && <Button onClick={() => open("new")}>New recipe</Button>}
      </div>
      <InventoryTabs />
      <p className="text-sm text-muted-foreground">A recipe says what a base quantity of a finished product takes. In the manufacturing voucher, choose it and press <b>Fill from recipe</b>: ingredient quantities scale to the quantity you plan, and you type what was actually used.</p>
      {(recipes ?? []).length === 0 ? <Card className="py-10 text-center text-sm text-muted-foreground">No saved recipes yet.</Card> : (
        <ul className="flex flex-col gap-2">
          {(recipes ?? []).map((r) => (
            <li key={r.id}><Card className="flex flex-col gap-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.name}</span><Badge variant="outline">v{r.version}</Badge>{!r.isActive && <Badge variant="outline">Retired</Badge>}<span className="text-muted-foreground">makes {r.baseOutputQty} {r.outputUnit.toLowerCase()} of {r.outputName}</span>
                {canEdit && <span className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => open(r)}>Edit</Button><Button variant="ghost" size="sm" onClick={() => m.setActive.mutate({ id: r.id, isActive: !r.isActive })}>{r.isActive ? "Retire" : "Restore"}</Button></span>}</div>
              <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">{r.lines.map((l) => <li key={l.ingredientId} className="flex justify-between border-b border-border/60 py-1"><span>{l.name}</span><span className="tabular-nums">{l.quantity} {l.unit}</span></li>)}</ul>
              {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
            </Card></li>
          ))}
        </ul>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{edit === "new" ? "New recipe" : "Edit recipe"}</DialogTitle><DialogDescription>Editing creates the next version. Vouchers already posted keep the version they used.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
              <div className="flex flex-col gap-1.5"><Label htmlFor="r-prod">Finished product</Label><select id="r-prod" className={selectClass} value={product} disabled={edit !== "new"} onChange={(e) => setProduct(e.target.value)}><option value="">Choose…</option>{products.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="r-name">Recipe name</Label><Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken momo" /></div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="r-base">Base output ({byId.get(product)?.unit.toLowerCase() ?? "units"})</Label><Input id="r-base" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} /></div>
            </div>
            <Label>Ingredients for the base output</Label>
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[1fr_6rem_6rem_2rem] gap-2">
                <select aria-label="Ingredient" className={selectClass} value={r.ingredientId} onChange={(e) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, ingredientId: e.target.value, unit: byId.get(e.target.value)?.unit ?? "" } : y)))}><option value="">Choose…</option>{raw.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                <Input aria-label="Quantity" inputMode="decimal" value={r.quantity} onChange={(e) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, quantity: e.target.value } : y)))} />
                <select aria-label="Unit" className={selectClass} value={r.unit} onChange={(e) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, unit: e.target.value as IngredientUnit } : y)))}>{(byId.get(r.ingredientId)?.units ?? []).map((u) => <option key={u}>{u}</option>)}</select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>×</Button>
              </div>
            ))}
            <div><Button type="button" variant="ghost" size="sm" onClick={() => setRows([...rows, { key: k++, ingredientId: "", quantity: "", unit: "" }])}>+ Add ingredient</Button></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="r-notes">Notes (optional)</Label><Input id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={m.create.isPending || m.update.isPending}>Save recipe</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
