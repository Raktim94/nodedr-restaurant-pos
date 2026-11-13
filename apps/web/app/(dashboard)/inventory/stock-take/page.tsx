"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useMemo, useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients } from "@/hooks/use-inventory";
import { type StockTakeResult, usePlaceMatrix, useStockItems, useStockTake } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { rank, STOCK_CATEGORIES, STORAGE_AREAS } from "@/lib/restaurant-stock";
import { toast } from "@/lib/toast";

// The shelf count every kitchen does: walk the store room, type what is really there, see the differences.
// Only items with a number typed are booked; the rest are left alone.
export default function StockTakePage() {
  const { branchId } = useBranch();
  const { data: ingredients, isLoading } = useIngredients(branchId);
  const { data: units } = useStockItems(branchId);
  const take = useStockTake(branchId);
  const { data: matrix } = usePlaceMatrix(branchId);
  const places = matrix?.locations ?? [];
  const [area, setArea] = useState("");
  const [blind, setBlind] = useState(false);
  const [note, setNote] = useState("");
  const [counts, setCounts] = useState<Record<string, { v: string; u: IngredientUnit | "" }>>({});
  const [result, setResult] = useState<StockTakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => `web-${crypto.randomUUID()}`);

  const items = useMemo(() => (ingredients ?? []).filter((i) => i.isActive !== false), [ingredients]);
  // Places the restaurant has set up (with their own balances) win; otherwise the labels on the items.
  const areas = places.length ? places.map((p) => p.name) : [...new Set(items.map((i) => i.storageLocation).filter((x): x is string => !!x))].sort((a, b) => rank(STORAGE_AREAS, a) - rank(STORAGE_AREAS, b));
  const place = places.find((p) => p.name === area);
  const placeLevel = (id: string) => (place ? matrix?.items.find((m) => m.id === id)?.levels[place.id] : undefined);
  const shown = items
    .filter((i) => !area || place || i.storageLocation === area)
    .sort((a, b) => rank(STOCK_CATEGORIES, a.category) - rank(STOCK_CATEGORIES, b.category) || (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));
  const unitsOf = (id: string) => units?.find((u) => u.id === id)?.units ?? [];
  const filled = Object.entries(counts).filter(([, c]) => c.v.trim() !== "");

  const submit = () => {
    setError(null);
    take.mutate(
      { area: area || undefined, note: note || undefined, idempotencyKey: key, lines: filled.map(([id, c]) => ({ ingredientId: id, counted: c.v.trim(), unit: (c.u || items.find((i) => i.id === id)!.unit) as IngredientUnit })) },
      {
        onSuccess: (r) => { setResult(r); setCounts({}); setKey(`web-${crypto.randomUUID()}`); toast.success("Stock take saved"); },
        onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the count. Nothing was changed."),
      },
    );
  };

  if (result) {
    const changed = result.lines.filter((l) => Number(l.difference) !== 0);
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <InventoryTabs />
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-lg font-semibold">Count saved</h2>
          <p className="text-sm text-muted-foreground">{result.lines.length} item(s) counted, {changed.length} different from the system. Each difference is in the Stock journal as an adjustment.</p>
          {changed.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {changed.map((l) => (<li key={l.ingredientId} className="flex justify-between"><span>{l.name}</span><span className={`tabular-nums ${Number(l.difference) < 0 ? "text-destructive" : ""}`}>{l.expected} → {l.counted} {l.unit} ({Number(l.difference) > 0 ? "+" : ""}{l.difference})</span></li>))}
            </ul>
          )}
          <div><Button onClick={() => setResult(null)}>Start another count</Button></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Header />
      <InventoryTabs />
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={!area} onClick={() => setArea("")} className={"rounded-full border px-3 py-1 text-sm " + (!area ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>All areas</button>
          {areas.map((a) => (<button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)} className={"rounded-full border px-3 py-1 text-sm " + (area === a ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>{a}</button>))}
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind count (hide system quantity)</label>
        </div>
        <p className="text-sm text-muted-foreground">Type what is really on the shelf. Leave an item empty to skip it. Nothing changes until you press Save count.</p>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((i, idx) => {
            const c = counts[i.id] ?? { v: "", u: "" as const };
            const sys = place ? Number(placeLevel(i.id) ?? 0) : Number(i.currentStock);
            const diff = c.v.trim() !== "" && c.u === "" ? Number(c.v) - sys : null;
            const header = idx === 0 || shown[idx - 1].category !== i.category;
            return (
              <li key={i.id}>
                {header && <h2 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i.category || "Other"}</h2>}
                <div className="grid grid-cols-[1fr_6rem_5rem] items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_8rem_6rem_7rem]">
                  <div className="col-span-3 sm:col-span-1">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.storageLocation ?? "No storage area"}{blind ? "" : ` · ${place ? `recorded here: ${placeLevel(i.id) ?? 0}` : `system: ${i.currentStock}`} ${i.unit}`}</p>
                  </div>
                  <Input aria-label={`Counted ${i.name}`} inputMode="decimal" placeholder="Counted" value={c.v} onChange={(e) => setCounts({ ...counts, [i.id]: { ...c, v: e.target.value } })} />
                  <select aria-label={`Unit for ${i.name}`} className={selectClass} value={c.u || i.unit} onChange={(e) => setCounts({ ...counts, [i.id]: { ...c, u: e.target.value === i.unit ? "" : (e.target.value as IngredientUnit) } })}>
                    {(unitsOf(i.id).length ? unitsOf(i.id) : [i.unit]).map((u) => (<option key={u}>{u}</option>))}
                  </select>
                  <span className={`hidden text-right text-sm tabular-nums sm:block ${diff && diff < 0 ? "text-destructive" : ""}`}>{!blind && diff !== null && diff !== 0 ? `${diff > 0 ? "+" : ""}${Math.round(diff * 1000) / 1000}` : ""}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background py-3">
        <Input aria-label="Note" className="max-w-xs" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="text-sm text-muted-foreground">{filled.length} counted</span>
        {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        <Button className="ml-auto" disabled={filled.length === 0 || take.isPending} onClick={submit}>{take.isPending ? "Saving…" : "Save count"}</Button>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
      <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
    </div>
  );
}
