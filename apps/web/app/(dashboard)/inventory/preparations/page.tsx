"use client";

import { costRecipe, type CostUnit, type Overhead } from "@nodedr-restaurant/types";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import {
  useCostingBundle,
  useDeletePreparation,
  usePreparations,
  useProduce,
  useSavePreparation,
  type PreparationView,
} from "@/hooks/use-costing";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/lib/toast";
import { uuid } from "@/lib/uuid";

const UNITS: CostUnit[] = ["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"];
const sel = "h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground";
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const money = (v: number | null) => (v === null ? "—" : formatCurrency(v));

interface Line { ingredientId: string; quantity: string; unit: CostUnit | "" }

export default function PreparationsPage() {
  const { branchId } = useBranch();
  const { data: preps, isLoading } = usePreparations(branchId);
  const [editing, setEditing] = useState<PreparationView | "new" | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Preparations</h1>
          <p className="text-sm text-muted-foreground">Sauces, dough, spice mixes and dishes cooked in batches. Cooking one uses the raw stock; selling it uses the finished stock.</p>
        </div>
        <Button onClick={() => setEditing("new")}>New preparation</Button>
      </div>
      <InventoryTabs />
      {editing && <Editor key={editing === "new" ? "new" : editing.id + editing.version} branchId={branchId} prep={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      {isLoading ? <Skeleton className="h-40 rounded-2xl" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(preps ?? []).map((p) => (
            <Card key={p.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Batch makes {p.batchOutputQty} {p.unit.toLowerCase()} · in stock {p.currentStock}</p>
                </div>
                <p className="text-right text-sm"><span className="font-semibold">{money(p.cost.costPerPortion)}</span><br /><span className="text-xs text-muted-foreground">per {p.unit.toLowerCase()}</span></p>
              </div>
              {!p.cost.complete && <p className="text-xs text-destructive">{p.cost.issues[0]?.message ?? "Some ingredients are unpriced"}</p>}
              <div className="flex flex-wrap gap-2">
                <Produce branchId={branchId} prep={p} />
                <Button variant="outline" size="sm" onClick={() => setEditing(p)}>Edit recipe</Button>
              </div>
            </Card>
          ))}
          {preps && preps.length === 0 && !editing && <p className="text-sm text-muted-foreground">No preparations yet.</p>}
        </div>
      )}
    </div>
  );
}

function Produce({ branchId, prep }: { branchId: string | null; prep: PreparationView }) {
  const produce = useProduce(branchId);
  const del = useDeletePreparation(branchId);
  const [batches, setBatches] = useState("1");
  // One key per attempt: a double tap or a retry after a dropped connection can never cook twice.
  const [key, setKey] = useState(() => uuid());
  const run = async () => {
    const b = num(batches);
    if (!(b > 0)) return toast.error("Enter how many batches");
    try {
      const r = await produce.mutateAsync({ id: prep.id, batches: b, idempotencyKey: key });
      setKey(uuid());
      toast.success(r.duplicate ? "Already recorded" : `Made ${r.run.outputQty} ${prep.unit.toLowerCase()} at ${money(r.run.unitCost)} each`);
      if (r.shortages.length) toast.error(`Stock was short for: ${r.shortages.join(", ")}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not record production");
    }
  };
  return (
    <>
      <Input aria-label="Batches" inputMode="decimal" className="h-9 w-16" value={batches} onChange={(e) => { setBatches(e.target.value); setKey(uuid()); }} />
      <Button size="sm" disabled={produce.isPending} onClick={run}>Cook batches</Button>
      <Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => del.mutate(prep.id, { onError: (e) => toast.error(e instanceof ApiError ? e.message : "Cannot delete") })}>Delete</Button>
    </>
  );
}

function Editor({ branchId, prep, onDone }: { branchId: string | null; prep: PreparationView | null; onDone: () => void }) {
  const { data: bundle } = useCostingBundle(branchId);
  const save = useSavePreparation(branchId);
  const [name, setName] = useState(prep?.name ?? "");
  const [unit, setUnit] = useState<CostUnit>(prep?.unit ?? "KG");
  const [out, setOut] = useState(String(prep?.batchOutputQty ?? 1));
  const [lines, setLines] = useState<Line[]>((prep?.lines ?? []).map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), unit: l.unit ?? "" })));
  const [over, setOver] = useState<{ kind: Overhead["kind"]; amount: string; basis: Overhead["basis"] }[]>((prep?.overheads ?? []).map((o) => ({ kind: o.kind, amount: String(o.amount), basis: o.basis })));
  const map = useMemo(() => new Map((bundle?.ingredients ?? []).map((i) => [i.id, i])), [bundle]);
  const options = (bundle?.ingredients ?? []).filter((i) => i.id !== prep?.id);
  const clean = lines.filter((l) => l.ingredientId && num(l.quantity) > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: num(l.quantity), unit: (l.unit || null) as CostUnit | null }));
  const cleanOver: Overhead[] = over.filter((o) => num(o.amount) > 0).map((o) => ({ kind: o.kind, amount: num(o.amount), basis: o.basis }));
  const live = costRecipe({ lines: clean, batchOutputQty: num(out), overheads: cleanOver }, map);

  const submit = () => {
    if (!name.trim()) return toast.error("Give it a name");
    if (clean.length === 0) return toast.error("Add at least one ingredient");
    save.mutate(
      { id: prep?.id, dto: { name: name.trim(), unit, batchOutputQty: num(out), lines: clean, overheads: cleanOver, baseVersion: prep?.version } },
      { onSuccess: () => { toast.success("Saved"); onDone(); }, onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save") },
    );
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="font-medium text-foreground">{prep ? `Edit ${prep.name}` : "New preparation"}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1"><Label htmlFor="pn">Name</Label><Input id="pn" className="h-11" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="flex flex-col gap-1"><Label htmlFor="po">One batch makes</Label><Input id="po" inputMode="decimal" className="h-11" value={out} onChange={(e) => setOut(e.target.value)} /></div>
        <div className="flex flex-col gap-1"><Label htmlFor="pu">Unit of the result</Label>
          <select id="pu" className={sel} value={unit} onChange={(e) => setUnit(e.target.value as CostUnit)}>{UNITS.map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}</select></div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_5.5rem_5.5rem_2.75rem] gap-2">
          <select aria-label="Ingredient" className={sel} value={l.ingredientId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value, unit: "" } : x)))}>
            <option value="">Ingredient or preparation…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <Input aria-label="Quantity" inputMode="decimal" className="h-11" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          <select aria-label="Unit" className={sel} value={l.unit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: e.target.value as CostUnit | "" } : x)))}>
            <option value="">{(map.get(l.ingredientId)?.unit ?? "unit").toLowerCase()}</option>
            {UNITS.map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}
          </select>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setLines((ls) => [...ls, { ingredientId: "", quantity: "", unit: "" }])}><Plus className="mr-1 h-4 w-4" />Add ingredient</Button>
      {over.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_5.5rem_8rem_2.75rem] gap-2">
          <select aria-label="Kind" className={sel} value={o.kind} onChange={(e) => setOver((os) => os.map((x, j) => (j === i ? { ...x, kind: e.target.value as Overhead["kind"] } : x)))}>
            <option value="PACKAGING">Packaging</option><option value="LABOUR">Labour</option><option value="ENERGY">Energy / gas</option><option value="OTHER">Other</option></select>
          <Input aria-label="Amount" inputMode="decimal" className="h-11" value={o.amount} onChange={(e) => setOver((os) => os.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <select aria-label="Applies" className={sel} value={o.basis} onChange={(e) => setOver((os) => os.map((x, j) => (j === i ? { ...x, basis: e.target.value as Overhead["basis"] } : x)))}><option value="PER_BATCH">per batch</option><option value="PER_PORTION">per {unit.toLowerCase()}</option></select>
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Remove cost" onClick={() => setOver((os) => os.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOver((os) => [...os, { kind: "LABOUR", amount: "", basis: "PER_BATCH" }])}><Plus className="mr-1 h-4 w-4" />Add labour, energy, packaging</Button>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-secondary/50 p-3 text-sm" aria-live="polite">
        <dt className="text-muted-foreground">Ingredient cost</dt><dd className="text-right">{money(live.ingredientCost)}</dd>
        <dt className="text-muted-foreground">Other costs</dt><dd className="text-right">{money(live.overheadCost)}</dd>
        <dt className="text-muted-foreground">Batch cost</dt><dd className="text-right font-medium">{money(live.batchCost)}</dd>
        <dt className="text-muted-foreground">Cost per {unit.toLowerCase()}</dt><dd className="text-right font-semibold">{money(live.costPerPortion)}</dd>
      </dl>
      {!live.complete && <p className="text-xs text-destructive">{live.issues[0]?.message}</p>}
      <div className="flex gap-2"><Button onClick={submit} disabled={save.isPending} className="h-11">Save</Button><Button variant="outline" className="h-11" onClick={onDone}>Cancel</Button></div>
    </Card>
  );
}
