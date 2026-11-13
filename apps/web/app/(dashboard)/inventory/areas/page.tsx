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
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { usePlaceActions, usePlaceMatrix, usePlaceTransfers, useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { STORAGE_AREAS } from "@/lib/restaurant-stock";
import { toast } from "@/lib/toast";

export default function AreasPage() {
  const { branchId } = useBranch();
  const { data, isLoading, isError } = usePlaceMatrix(branchId);
  const { data: log } = usePlaceTransfers(branchId);
  const { data: stockItems } = useStockItems(branchId);
  const act = usePlaceActions(branchId);
  const [name, setName] = useState("");
  const [moving, setMoving] = useState(false);
  const [item, setItem] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not do that");
  const places = data?.locations ?? [];
  const chosen = stockItems?.find((s) => s.id === item);
  const missing = STORAGE_AREAS.filter((a) => !places.some((p) => p.name === a));

  const move = () => {
    setErr(null);
    act.transfer.mutate({ ingredientId: item, fromLocationId: from || null, toLocationId: to, quantity: qty.trim(), unit: (unit || chosen?.unit) as IngredientUnit }, {
      onSuccess: () => { toast.success("Moved"); setMoving(false); setQty(""); },
      onError: (e) => setErr(e instanceof ApiError ? e.message : "Could not move it"),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        <Button disabled={places.length < 2} onClick={() => setMoving(true)}>Move stock</Button>
      </div>
      <InventoryTabs />

      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium">Places you keep stock</p>
        <div className="flex flex-wrap gap-2">
          {places.map((p) => (<Badge key={p.id} variant="outline" className="text-sm">{p.name}</Badge>))}
          {places.length === 0 && <span className="text-sm text-muted-foreground">No places yet. Add the dry store, fridge, freezer and so on to track what is where.</span>}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) act.create.mutate(name.trim(), { onSuccess: () => setName(""), onError: fail }); }}>
          <Input aria-label="New place" list="place-list" className="max-w-56" placeholder="Add a place…" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="place-list">{missing.map((a) => (<option key={a} value={a} />))}</datalist>
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || act.create.isPending}>Add place</Button>
        </form>
        <p className="text-xs text-muted-foreground">An item&rsquo;s total is still the one number sales, production and waste move. Each place says how much of it is there; what is not placed yet shows as Unassigned. Count a place under Stock take to fill it in.</p>
      </Card>

      {isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : isError ? (
        <Card className="p-6 text-sm text-destructive">Could not load the places.</Card>
      ) : data && places.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Total</th>{places.map((p) => (<th key={p.id} className="px-3 py-2 text-right font-medium">{p.name}</th>))}<th className="px-3 py-2 text-right font-medium">Unassigned</th></tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{i.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.total} <span className="text-muted-foreground">{i.unit}</span></td>
                  {places.map((p) => (<td key={p.id} className="px-3 py-2 text-right tabular-nums">{Number(i.levels[p.id]) ? i.levels[p.id] : <span className="text-muted-foreground">–</span>}</td>))}
                  <td className={`px-3 py-2 text-right tabular-nums ${i.needsRecount ? "font-semibold text-destructive" : ""}`}>{i.needsRecount ? "Recount" : Number(i.unassigned) ? i.unassigned : <span className="text-muted-foreground">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {log && log.length > 0 && (
        <section aria-label="Recent moves" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Recent moves</h2>
          <Card className="p-0"><ul className="divide-y divide-border text-sm">
            {log.map((t) => (<li key={t.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5"><span><span className="font-medium">{t.item?.name}</span> {t.from} → {t.to}</span><span className="text-muted-foreground tabular-nums">{t.quantity} {t.item?.unit} · {t.by} · {new Date(t.createdAt).toLocaleString()}</span></li>))}
          </ul></Card>
        </section>
      )}

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Move stock</DialogTitle><DialogDescription>From one place to another. The item&rsquo;s total does not change.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            <select aria-label="Item" className={selectClass} value={item} onChange={(e) => { setItem(e.target.value); setUnit(""); }}><option value="">Choose item…</option>{(stockItems ?? []).map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="From" className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Unassigned</option>{places.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>
              <select aria-label="To" className={selectClass} value={to} onChange={(e) => setTo(e.target.value)}><option value="">To…</option>{places.filter((p) => p.id !== from).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Input aria-label="Quantity" inputMode="decimal" placeholder="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
              <select aria-label="Unit" className={selectClass} value={unit || chosen?.unit || ""} onChange={(e) => setUnit(e.target.value)}>{(chosen?.units ?? []).map((u) => (<option key={u}>{u}</option>))}</select>
            </div>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMoving(false)}>Cancel</Button><Button disabled={!item || !to || !qty.trim() || act.transfer.isPending} onClick={move}>Move</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
