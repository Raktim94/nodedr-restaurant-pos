"use client";

import { useState } from "react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { ProductionEntryDialog, selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import {
  csvUrl,
  type ProductionEntry,
  useProductionAction,
  useProductionEntries,
  useProductionReport,
  useStockItems,
} from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const today = () => new Date().toISOString().slice(0, 10);
const startOf = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOf = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

const STATUS_LABEL = { DRAFT: "Draft", POSTED: "Posted", VOIDED: "Reversed" } as const;

export default function ProductionPage() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canReverse = hasPermission(me?.user, "production.void");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [productId, setProductId] = useState("");
  const [shift, setShift] = useState("");
  const [location, setLocation] = useState("");
  const filters = { from: startOf(from), to: endOf(to), productId, shift, location };
  const { data: items } = useStockItems(branchId);
  const { data: entries, isLoading, isError } = useProductionEntries(branchId, filters);
  const { data: report } = useProductionReport(branchId, filters);
  const act = useProductionAction(branchId);
  const [creating, setCreating] = useState(false);
  const [correcting, setCorrecting] = useState<ProductionEntry | null>(null);
  const [voiding, setVoiding] = useState<ProductionEntry | null>(null);
  const [reason, setReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const doVoid = () => {
    if (!voiding) return;
    setVoidError(null);
    act.mutate(
      { id: voiding.id, action: "void", body: { reason } },
      {
        onSuccess: () => { toast.success("Entry reversed. Stock was put back."); setVoiding(null); setReason(""); },
        onError: (e) => setVoidError(e instanceof ApiError ? e.message : "Could not reverse"),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        <Button onClick={() => setCreating(true)}>New production entry</Button>
      </div>

      <InventoryTabs />

      <Card className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5"><Label htmlFor="f-from">From</Label><Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="f-to">To</Label><Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-prod">Product</Label>
          <select id="f-prod" className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">All</option>
            {(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-shift">Shift</Label>
          <select id="f-shift" className={selectClass} value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">All</option>
            {["Morning", "Afternoon", "Evening", "Night"].map((s) => (<option key={s}>{s}</option>))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="f-loc">Location</Label><Input id="f-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Any" /></div>
        <div className="flex items-end"><a className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" href={csvUrl("production/export.csv", branchId, filters)}>Export CSV</a></div>
      </Card>

      {report && report.entryCount > 0 && (
        <section aria-label="Daily summary" className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Produced</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {report.produced.map((p) => (<li key={p.ingredientId} className="flex justify-between"><span>{p.name}</span><span className="tabular-nums">{p.quantity} {p.unit}</span></li>))}
            </ul>
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Ingredients used</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {report.consumed.map((p) => (<li key={p.ingredientId} className="flex justify-between"><span>{p.name}</span><span className="tabular-nums">{p.quantity} {p.unit}</span></li>))}
            </ul>
          </Card>
          <p className="text-xs text-muted-foreground md:col-span-2">Posted entries in this period only. Quantities, no costs.</p>
        </section>
      )}

      <section aria-label="Entries" className="flex flex-col gap-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : isError ? (
          <Card className="p-6 text-sm text-destructive">Could not load production entries. Check the connection and try again.</Card>
        ) : entries && entries.length > 0 ? (
          entries.map((e) => (
            <Card key={e.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{e.entryNo}</span>
                <Badge variant={e.status === "POSTED" ? "default" : "outline"}>{STATUS_LABEL[e.status]}</Badge>
                <span className="text-sm text-muted-foreground">{new Date(e.producedAt).toLocaleString()}</span>
                {e.shift && <span className="text-sm text-muted-foreground">· {e.shift}</span>}
                {e.location && <span className="text-sm text-muted-foreground">· {e.location}</span>}
                {e.responsibleName && <span className="text-sm text-muted-foreground">· {e.responsibleName}</span>}
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Made</p>
                  {e.lines.filter((l) => l.role === "OUTPUT").map((l) => (<p key={l.id} className="tabular-nums">{l.enteredQuantity} {l.enteredUnit} {l.ingredient.name}</p>))}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Used</p>
                  {e.lines.filter((l) => l.role === "INPUT").map((l) => (<p key={l.id} className="tabular-nums">{l.enteredQuantity} {l.enteredUnit} {l.ingredient.name}</p>))}
                </div>
              </div>
              {e.voidReason && <p className="text-sm text-muted-foreground">Reversed: {e.voidReason}</p>}
              {e.correctsEntry && <p className="text-sm text-muted-foreground">Corrects {e.correctsEntry.entryNo}</p>}
              {e.correctedBy.length > 0 && <p className="text-sm text-muted-foreground">Replaced by {e.correctedBy.map((c) => c.entryNo).join(", ")}</p>}
              <div className="flex flex-wrap gap-2">
                {e.status === "DRAFT" && (<Button size="sm" onClick={() => act.mutate({ id: e.id, action: "post" }, { onSuccess: () => toast.success("Posted"), onError: (er) => toast.error(er instanceof ApiError ? er.message : "Could not post") })}>Post</Button>)}
                {e.status === "POSTED" && canReverse && (<>
                  <Button size="sm" variant="outline" onClick={() => setCorrecting(e)}>Correct</Button>
                  <Button size="sm" variant="destructive" onClick={() => { setVoiding(e); setVoidError(null); }}>Reverse</Button>
                </>)}
              </div>
            </Card>
          ))
        ) : (
          <Card className="flex flex-col items-center gap-2 py-14 text-center">
            <p className="text-sm font-medium">No production recorded for this period</p>
            <p className="text-sm text-muted-foreground">Record a batch to see what was made and what it used.</p>
            <Button size="sm" onClick={() => setCreating(true)}>New production entry</Button>
          </Card>
        )}
      </section>

      {creating && <ProductionEntryDialog key="new" branchId={branchId} open onOpenChange={setCreating} />}
      {correcting && <ProductionEntryDialog key={correcting.id} branchId={branchId} open correcting={correcting} onOpenChange={(o) => !o && setCorrecting(null)} />}

      <Dialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse {voiding?.entryNo}?</DialogTitle>
            <DialogDescription>The ingredients go back into stock and the finished quantity comes out. The original entry stays on record as reversed.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-reason">Reason</Label>
            <Input id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          {voidError && <p role="alert" className="text-sm text-destructive">{voidError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>Keep it</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || act.isPending} onClick={doVoid}>Reverse entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
