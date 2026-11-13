"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import type { IngredientUnit } from "@nodedr-restaurant/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { useCreateIngredient } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

const UNITS: IngredientUnit[] = ["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"];

interface Conv { unit: IngredientUnit; per: string }

export function AddIngredientDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"PURCHASED" | "PREPARED">("PURCHASED");
  const [unit, setUnit] = useState<IngredientUnit>("KG");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [location, setLocation] = useState("");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [approvalQty, setApprovalQty] = useState("");
  const [convs, setConvs] = useState<Conv[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createIngredient = useCreateIngredient(branchId);

  const reset = () => {
    setName(""); setKind("PURCHASED"); setUnit("KG"); setCategory(""); setSku(""); setLocation("");
    setReorderLevel("0"); setApprovalQty(""); setConvs([]); setError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (convs.some((c) => !(Number(c.per) > 0))) return setError("Fill in every conversion, or remove the row.");
    createIngredient.mutate(
      {
        name,
        unit,
        kind,
        sku: sku || undefined,
        category: category || null,
        storageLocation: location || null,
        reorderLevel: Number(reorderLevel) || 0,
        wasteApprovalQty: approvalQty ? Number(approvalQty) : null,
        conversions: convs.map((c) => ({ unit: c.unit, per: Number(c.per) })),
        isActive: true,
      },
      {
        onSuccess: () => { toast.success(`${name} added`); setOpen(false); reset(); },
        onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add the item"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New stock item</Button>} />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>New stock item</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-kind">Type</Label>
            <select id="i-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as "PURCHASED" | "PREPARED")}>
              <option value="PURCHASED">Raw material or purchased item</option>
              <option value="PREPARED">Finished product made in the kitchen</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="i-name">Name</Label>
            <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-unit">Stock unit</Label>
              <select id="i-unit" className={selectClass} value={unit} onChange={(e) => setUnit(e.target.value as IngredientUnit)}>
                {UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-reorder">Minimum stock</Label>
              <Input id="i-reorder" inputMode="decimal" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-cat">Category</Label>
              <Input id="i-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Grains" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-sku">SKU / barcode</Label>
              <Input id="i-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-loc">Storage location</Label>
              <Input id="i-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Dry store" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="i-appr">Waste needs approval above</Label>
              <Input id="i-appr" inputMode="decimal" value={approvalQty} onChange={(e) => setApprovalQty(e.target.value)} placeholder={`in ${unit}, blank = never`} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Other units for this item</Label>
            <p className="text-xs text-muted-foreground">
              {unit === "KG" || unit === "G" || unit === "L" || unit === "ML" || unit === "PIECE" || unit === "DOZEN"
                ? "Kilo/gram, litre/millilitre and piece/dozen already convert. Add a row only for something else."
                : "Say how much one stock unit holds, for example 1 PACK = 25000 G."}
            </p>
            {convs.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm">1 {unit} =</span>
                <Input aria-label="Amount" className="w-28" inputMode="decimal" value={c.per} onChange={(e) => setConvs(convs.map((x, j) => (j === i ? { ...x, per: e.target.value } : x)))} />
                <select aria-label="Unit" className={`${selectClass} w-24`} value={c.unit} onChange={(e) => setConvs(convs.map((x, j) => (j === i ? { ...x, unit: e.target.value as IngredientUnit } : x)))}>
                  {UNITS.filter((u) => u !== unit).map((u) => (<option key={u} value={u}>{u}</option>))}
                </select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove conversion" onClick={() => setConvs(convs.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <div><Button type="button" variant="ghost" size="sm" onClick={() => setConvs([...convs, { unit: UNITS.find((u) => u !== unit) ?? "G", per: "" }])}>+ Add a unit</Button></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createIngredient.isPending}>{createIngredient.isPending ? "Adding…" : "Add item"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
