"use client";

import { convertQty, type CostUnit } from "@nodedr-restaurant/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateIngredient, type Ingredient } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const UNITS: CostUnit[] = ["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"];
const sel = "h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground";

// How an ingredient is priced: the existing weighted average of purchases, or a purchase cost typed
// in by hand. Yield is the ONLY place wastage is entered (trimming, peeling, cleaning).
export function IngredientCostDialog({ branchId, ingredient }: { branchId: string | null; ingredient: Ingredient }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateIngredient(branchId);
  const [method, setMethod] = useState<"AVERAGE" | "MANUAL">(ingredient.costMethod === "MANUAL" ? "MANUAL" : "AVERAGE");
  const [qty, setQty] = useState(ingredient.purchaseQuantity ?? "");
  const [unit, setUnit] = useState<CostUnit>((ingredient.purchaseUnit ?? ingredient.unit) as CostUnit);
  const [price, setPrice] = useState(ingredient.purchasePrice ?? "");
  const [yieldPct, setYieldPct] = useState(ingredient.yieldPercent ?? "100");
  const [conv, setConv] = useState<{ unit: CostUnit; per: string }[]>((ingredient.conversions ?? []).map((c) => ({ unit: c.unit as CostUnit, per: String(c.per) })));

  if (ingredient.kind === "PREPARED") return null; // priced from its own recipe under Preparations

  const stockUnit = ingredient.unit as CostUnit;
  const perStock =
    Number(qty) > 0 && price !== ""
      ? convertQty(Number(qty), unit, stockUnit, stockUnit, conv.filter((c) => Number(c.per) > 0).map((c) => ({ unit: c.unit, per: Number(c.per) })))
      : null;
  const manualPerUnit = perStock && perStock > 0 ? Number(price) / perStock : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const y = Number(yieldPct);
    if (!(y > 0 && y <= 100)) return toast.error("Usable yield must be above 0% and at most 100%");
    if (method === "MANUAL" && manualPerUnit === null) return toast.error("Enter the purchase quantity and price (and a conversion if the units differ)");
    update.mutate(
      {
        id: ingredient.id,
        dto: {
          costMethod: method,
          purchaseQuantity: qty === "" ? null : Number(qty),
          purchaseUnit: qty === "" ? null : unit,
          purchasePrice: price === "" ? null : Number(price),
          yieldPercent: y,
          conversions: conv.filter((c) => Number(c.per) > 0).map((c) => ({ unit: c.unit, per: Number(c.per) })),
          baseVersion: ingredient.version,
        },
      },
      {
        onSuccess: () => { toast.success("Cost saved"); setOpen(false); },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Cost</Button>} />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader><DialogTitle>{ingredient.name}: cost &amp; yield</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Costing method">
            {([["AVERAGE", "From purchases"], ["MANUAL", "Manual price"]] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={method === v} onClick={() => setMethod(v)}
                className={"min-h-11 rounded-lg border px-2 text-sm " + (method === v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {method === "AVERAGE"
              ? `Uses the weighted average of your goods receipts (now ${Number(ingredient.costPerUnit).toFixed(2)} per ${ingredient.unit.toLowerCase()}). Until the first receipt, the manual price below is used and labelled as such.`
              : "Uses the purchase price below. Goods receipts do not change it."}
          </p>
          <div className="grid grid-cols-[1fr_6rem_1fr] gap-2">
            <div className="flex flex-col gap-1"><Label htmlFor="pq">Bought</Label><Input id="pq" inputMode="decimal" className="h-11" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="pu">Unit</Label>
              <select id="pu" className={sel} value={unit} onChange={(e) => setUnit(e.target.value as CostUnit)}>{UNITS.map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}</select></div>
            <div className="flex flex-col gap-1"><Label htmlFor="pp">For (price)</Label><Input id="pp" inputMode="decimal" className="h-11" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          </div>
          {manualPerUnit !== null && <p className="text-xs text-muted-foreground">= {manualPerUnit.toFixed(2)} per {ingredient.unit.toLowerCase()} (stock unit)</p>}
          {Number(qty) > 0 && price !== "" && perStock === null && <p className="text-xs text-destructive">These units cannot be converted — add a conversion below.</p>}
          <div className="flex flex-col gap-1">
            <Label htmlFor="yp">Usable yield %</Label>
            <Input id="yp" inputMode="decimal" className="h-11 w-28" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
            <p className="text-xs text-muted-foreground">Share left after trimming or cleaning. 80% means you pay for 1.25 kg to get 1 kg usable. Counted once, here — not again in recipes.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Unit bridge <span className="font-normal text-muted-foreground">(only if you mix weight, volume or count)</span></Label>
            {conv.map((c, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_6rem_2.75rem] items-center gap-2">
                <span className="text-sm">1 {ingredient.unit.toLowerCase()} =</span>
                <Input aria-label="Amount" inputMode="decimal" className="h-11" value={c.per} onChange={(e) => setConv((cs) => cs.map((x, j) => (j === i ? { ...x, per: e.target.value } : x)))} />
                <select aria-label="Unit" className={sel} value={c.unit} onChange={(e) => setConv((cs) => cs.map((x, j) => (j === i ? { ...x, unit: e.target.value as CostUnit } : x)))}>{UNITS.map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}</select>
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Remove" onClick={() => setConv((cs) => cs.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setConv((cs) => [...cs, { unit: "G", per: "" }])}>Add bridge, e.g. 1 L = 920 g</Button>
          </div>
          <DialogFooter><Button type="submit" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
