"use client";

import type { IngredientUnit, WasteReason } from "@nodedr-restaurant/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { useCreateWaste, useProductionEntries, useStockItems } from "@/hooks/use-stock-journal";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

export const WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: "SPOILED", label: "Spoiled" },
  { value: "EXPIRED", label: "Expired" },
  { value: "OVER_PRODUCTION", label: "Over-prepared" },
  { value: "DAMAGED", label: "Dropped / damaged" },
  { value: "RETURNED_PLATE", label: "Returned / plate waste" },
  { value: "PREP_TRIM", label: "Preparation trim" },
  { value: "STORAGE_TEMPERATURE", label: "Temperature / storage issue" },
  { value: "PREP_ERROR", label: "Prep error" },
  { value: "OTHER", label: "Other" },
];

// Built for service time: item, quantity, reason, one tap. The only extra choice is whether the loss is
// already inside a production entry, so the same food is never taken off stock twice.
export function LogWasteDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState<WasteReason>("SPOILED");
  const [shift, setShift] = useState("");
  const [note, setNote] = useState("");
  const [inProd, setInProd] = useState(false);
  const [prodId, setProdId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { data: items } = useStockItems(branchId);
  const { data: entries } = useProductionEntries(branchId, { status: "POSTED" });
  const create = useCreateWaste(branchId);
  const chosen = items?.find((i) => i.id === item);
  const candidates = (entries ?? []).filter((e) => e.lines.some((l) => l.ingredientId === item));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    // The photo is optional: if it cannot be uploaded the waste is still recorded, without it.
    let photoUrl: string | undefined;
    if (photo) {
      setUploading(true);
      try {
        photoUrl = (await api.upload<{ url: string }>(`/inventory/waste/photo?branchId=${branchId}`, photo)).url;
      } catch {
        toast.error("The photo could not be uploaded. Recording the waste without it.");
      }
      setUploading(false);
    }
    create.mutate(
      {
        ingredientId: item, quantity: qty, unit: (unit || chosen?.unit) as IngredientUnit, reason,
        shift: shift || undefined, note: note || undefined, photoUrl,
        includedInProduction: inProd, productionEntryId: inProd ? prodId : undefined,
        idempotencyKey: `web-${crypto.randomUUID()}`,
      },
      {
        onSuccess: (r) => {
          toast.success(r.status === "PENDING_APPROVAL" ? "Recorded. A manager will review it." : "Waste recorded");
          setOpen(false); setPhoto(null); setItem(""); setQty(""); setNote(""); setInProd(false); setProdId("");
        },
        onError: (er) => setErr(er instanceof ApiError ? er.message : "Could not record"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Record waste</Button>} />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader><DialogTitle>Record food waste</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="w-item">Item</Label>
            <select id="w-item" className={selectClass} value={item} onChange={(e) => { setItem(e.target.value); setUnit(""); setProdId(""); }} required>
              <option value="">Choose…</option>
              <optgroup label="Finished food">{(items ?? []).filter((i) => i.kind === "PREPARED").map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}</optgroup>
              <optgroup label="Ingredients">{(items ?? []).filter((i) => i.kind === "PURCHASED").map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}</optgroup>
            </select>
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div className="flex flex-col gap-1.5"><Label htmlFor="w-qty">Quantity</Label><Input id="w-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="w-unit">Unit</Label>
              <select id="w-unit" className={selectClass} value={unit || chosen?.unit || ""} onChange={(e) => setUnit(e.target.value)}>{(chosen?.units ?? []).map((u) => (<option key={u}>{u}</option>))}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5"><Label htmlFor="w-reason">Reason</Label>
              <select id="w-reason" className={selectClass} value={reason} onChange={(e) => setReason(e.target.value as WasteReason)}>{WASTE_REASONS.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}</select></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="w-shift">Shift</Label>
              <select id="w-shift" className={selectClass} value={shift} onChange={(e) => setShift(e.target.value)}><option value="">None</option>{["Morning", "Afternoon", "Evening", "Night"].map((s) => (<option key={s}>{s}</option>))}</select></div>
          </div>
          <Input aria-label="Note" placeholder={reason === "OTHER" ? "What happened? (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="flex flex-col gap-1.5 text-sm">Photo (optional)<input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Is this already counted in a production entry?</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!inProd} onChange={() => setInProd(false)} /> No, take it off stock now</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={inProd} onChange={() => setInProd(true)} /> Yes, the batch simply made less (stock is not changed again)</label>
            {inProd && (
              <select aria-label="Production entry" className={selectClass} value={prodId} onChange={(e) => setProdId(e.target.value)} required>
                <option value="">Choose the production entry…</option>
                {candidates.map((c) => (<option key={c.id} value={c.id}>{c.entryNo} · {new Date(c.producedAt).toLocaleDateString()}</option>))}
              </select>
            )}
          </fieldset>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <DialogFooter><Button type="submit" disabled={create.isPending || uploading || !item}>{create.isPending || uploading ? "Saving…" : "Record waste"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
