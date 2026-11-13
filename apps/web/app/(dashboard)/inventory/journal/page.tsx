"use client";

import { useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { csvUrl, useJournal, useJournalAdjust, useReceiveStock, useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const TYPES: Record<string, string> = {
  OPENING: "Opening balance", RECEIPT: "Received", PRODUCTION_USE: "Used in production", PRODUCTION: "Produced",
  CONSUMPTION: "Sold", WASTE: "Waste", ADJUSTMENT: "Adjustment", REVERSAL: "Reversal",
};

type Mode = "receive" | "adjust" | null;

export default function JournalPage() {
  const { branchId } = useBranch();
  const [ingredientId, setIngredientId] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = {
    ingredientId, type,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  };
  const { data: items } = useStockItems(branchId);
  const { data, isLoading, isError } = useJournal(branchId, filters);
  const [mode, setMode] = useState<Mode>(null);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [text, setText] = useState("");
  const [dir, setDir] = useState<"ADD" | "REMOVE">("REMOVE");
  const [err, setErr] = useState<string | null>(null);
  const receive = useReceiveStock(branchId);
  const adjust = useJournalAdjust(branchId);
  const chosen = items?.find((i) => i.id === item);

  const close = () => { setMode(null); setItem(""); setQty(""); setUnit(""); setText(""); setErr(null); };
  const submit = () => {
    const u = (unit || chosen?.unit) as never;
    const onError = (e: unknown) => setErr(e instanceof ApiError ? e.message : "Could not save");
    if (mode === "receive") {
      receive.mutate({ ingredientId: item, quantity: qty, unit: u, reference: text || undefined }, { onSuccess: () => { toast.success("Stock received"); close(); }, onError });
    } else {
      adjust.mutate({ ingredientId: item, direction: dir, quantity: qty, unit: u, reason: text }, { onSuccess: () => { toast.success("Adjustment recorded"); close(); }, onError });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setMode("adjust")}>Adjust stock</Button>
          <Button onClick={() => setMode("receive")}>Receive stock</Button>
        </div>
      </div>
      <InventoryTabs />

      <Card className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="j-item">Item</Label>
          <select id="j-item" className={selectClass} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
            <option value="">All items</option>
            {(items ?? []).map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="j-type">Type</Label>
          <select id="j-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {Object.entries(TYPES).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="j-from">From</Label><Input id="j-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="j-to">To</Label><Input id="j-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex items-end"><a className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" href={csvUrl("journal/export.csv", branchId, filters)}>Export CSV</a></div>
      </Card>

      <Card className="overflow-x-auto p-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
        ) : isError ? (
          <p className="p-6 text-sm text-destructive">Could not load the journal.</p>
        ) : data && data.items.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>By</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{m.ingredient.name}</TableCell>
                  <TableCell><Badge variant="outline">{TYPES[m.type] ?? m.type}</Badge></TableCell>
                  <TableCell className={`text-right tabular-nums ${Number(m.quantity) < 0 ? "text-destructive" : ""}`}>{Number(m.quantity) > 0 ? "+" : ""}{m.quantity} {m.ingredient.unit}</TableCell>
                  <TableCell className="text-muted-foreground">{m.createdBy.name}{m.deviceId ? ` (${m.deviceId})` : ""}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground" title={m.note ?? ""}>{m.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-14 text-center text-sm text-muted-foreground">No stock movements match these filters.</p>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">Every movement is kept. A mistake is fixed by a reversal or an adjustment, never by editing or deleting a line.</p>

      <Dialog open={!!mode} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "receive" ? "Receive stock" : "Adjust stock"}</DialogTitle>
            <DialogDescription>{mode === "receive" ? "Record raw material that arrived." : "Correct a count. A reason is required and stock cannot go below zero."}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <select aria-label="Item" className={selectClass} value={item} onChange={(e) => { setItem(e.target.value); setUnit(""); }}>
              <option value="">Choose item…</option>
              {(items ?? []).map((i) => (<option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit})</option>))}
            </select>
            {mode === "adjust" && (
              <select aria-label="Direction" className={selectClass} value={dir} onChange={(e) => setDir(e.target.value as "ADD" | "REMOVE")}>
                <option value="REMOVE">Remove from stock</option><option value="ADD">Add to stock</option>
              </select>
            )}
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Input aria-label="Quantity" inputMode="decimal" placeholder="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
              <select aria-label="Unit" className={selectClass} value={unit || chosen?.unit || ""} onChange={(e) => setUnit(e.target.value)}>
                {(chosen?.units ?? []).map((u) => (<option key={u}>{u}</option>))}
              </select>
            </div>
            <Input aria-label={mode === "receive" ? "Supplier or invoice reference" : "Reason"} placeholder={mode === "receive" ? "Supplier / invoice reference (optional)" : "Reason (required)"} value={text} onChange={(e) => setText(e.target.value)} />
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!item || !qty || (mode === "adjust" && text.trim().length < 3) || receive.isPending || adjust.isPending} onClick={submit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
