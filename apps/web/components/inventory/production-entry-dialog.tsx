"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type PreviewLine,
  type ProductionEntry,
  usePreviewProduction,
  useProductionAction,
  useSaveProduction,
  useStockItems,
  useSuggestions,
} from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

interface Row {
  key: number;
  ingredientId: string;
  quantity: string;
  unit: IngredientUnit | "";
  hint?: string;
}

const SHIFTS = ["Morning", "Afternoon", "Evening", "Night"];
let rowKey = 1;
const blank = (over: Partial<Row> = {}): Row => ({ key: rowKey++, ingredientId: "", quantity: "", unit: "", ...over });

export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

function fromEntry(e: ProductionEntry | undefined, role: "INPUT" | "OUTPUT"): Row[] {
  const rows = (e?.lines ?? [])
    .filter((l) => l.role === role)
    .map((l) => blank({ ingredientId: l.ingredientId, quantity: l.enteredQuantity, unit: l.enteredUnit }));
  return rows.length ? rows : [blank()];
}

// Guided "New production entry". Staff type what was really used and what really came out. Nothing here
// is calculated from a recipe, and nothing here shows a cost.
export function ProductionEntryDialog({
  branchId,
  open,
  onOpenChange,
  correcting,
}: {
  branchId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** A posted entry being replaced: starts from its numbers and asks for a reason. */
  correcting?: ProductionEntry;
}) {
  const { data: items } = useStockItems(branchId);
  const raw = useMemo(() => items ?? [], [items]);
  const products = useMemo(() => (items ?? []).filter((i) => i.kind === "PREPARED"), [items]);
  const [step, setStep] = useState<"form" | "review">("form");
  const [inputs, setInputs] = useState<Row[]>(() => fromEntry(correcting, "INPUT"));
  const [outputs, setOutputs] = useState<Row[]>(() => fromEntry(correcting, "OUTPUT"));
  const [shift, setShift] = useState(correcting?.shift ?? "");
  const [location, setLocation] = useState(correcting?.location ?? "");
  const [batchRef, setBatchRef] = useState(correcting?.batchRef ?? "");
  const [notes, setNotes] = useState(correcting?.notes ?? "");
  const [producedAt, setProducedAt] = useState(() => toLocalInput(correcting ? new Date(correcting.producedAt) : new Date()));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ lines: PreviewLine[]; canPost: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewMut = usePreviewProduction(branchId);
  const save = useSaveProduction(branchId);
  const action = useProductionAction(branchId);
  const firstProduct = outputs[0]?.ingredientId ?? "";
  const { data: suggestions } = useSuggestions(branchId, firstProduct);

  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const setRow = (set: typeof setInputs, key: number, patch: Partial<Row>) =>
    set((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pick = (set: typeof setInputs, key: number, id: string) =>
    setRow(set, key, { ingredientId: id, unit: byId.get(id)?.unit ?? "" });

  const clean = (rows: Row[]) =>
    rows.filter((r) => r.ingredientId || r.quantity).map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit }));
  const problem = () => {
    const i = clean(inputs);
    const o = clean(outputs);
    if (!o.length || o.some((l) => !l.ingredientId)) return "Choose the finished product that was made.";
    if (!i.length || i.some((l) => !l.ingredientId)) return "Add each ingredient that was used.";
    if ([...i, ...o].some((l) => !l.quantity || !(Number(l.quantity) > 0))) return "Type the actual quantity on every row.";
    if (correcting && reason.trim().length < 3) return "Say why this entry is being corrected.";
    return null;
  };
  const payload = () => ({
    producedAt: new Date(producedAt),
    shift: shift || undefined,
    location: location || undefined,
    batchRef: batchRef || undefined,
    notes: notes || undefined,
    inputs: clean(inputs),
    outputs: clean(outputs),
  });
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not save. Nothing was changed.");

  const review = () => {
    const p = problem();
    if (p) return setError(p);
    setError(null);
    const { inputs: i, outputs: o } = payload();
    previewMut.mutate({ inputs: i, outputs: o }, { onSuccess: (r) => { setPreview(r); setStep("review"); }, onError: fail });
  };

  const done = (msg: string) => { toast.success(msg); onOpenChange(false); };
  const post = () => {
    setError(null);
    if (correcting) {
      action.mutate({ id: correcting.id, action: "correct", body: { ...payload(), reason } }, { onSuccess: () => done("Corrected. The old entry was reversed."), onError: fail });
    } else {
      save.mutate({ ...payload(), idempotencyKey: `web-${crypto.randomUUID()}`, post: true }, { onSuccess: () => done("Production posted"), onError: fail });
    }
  };
  const draft = () => save.mutate({ ...payload(), post: false }, { onSuccess: () => done("Saved as a draft. Stock has not changed."), onError: fail });
  const busy = save.isPending || action.isPending || previewMut.isPending;

  const lineRow = (set: typeof setInputs, rows: Row[], r: Row, list: typeof raw, label: string) => {
    const unitOptions = byId.get(r.ingredientId)?.units ?? [];
    return (
      <div key={r.key} className="grid grid-cols-[1fr_6.5rem_5.5rem_2rem] items-center gap-2">
        <select aria-label={`${label} item`} className={selectClass} value={r.ingredientId} onChange={(e) => pick(set, r.key, e.target.value)}>
          <option value="">Choose…</option>
          {list.map((i) => (<option key={i.id} value={i.id}>{i.name}</option>))}
        </select>
        <Input aria-label={`${label} quantity`} inputMode="decimal" placeholder={r.hint ? `last: ${r.hint}` : "Qty"} value={r.quantity} onChange={(e) => setRow(set, r.key, { quantity: e.target.value })} />
        <select aria-label={`${label} unit`} className={selectClass} value={r.unit} onChange={(e) => setRow(set, r.key, { unit: e.target.value as IngredientUnit })}>
          {unitOptions.map((u) => (<option key={u} value={u}>{u}</option>))}
        </select>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label} row`} disabled={rows.length === 1} onClick={() => set(rows.filter((x) => x.key !== r.key))}>×</Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{correcting ? `Correct ${correcting.entryNo}` : "New production entry"}</DialogTitle>
          <DialogDescription>
            Record what was actually used and what was actually made. This tracks quantities only; it does not work out a cost.
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2" aria-label="Finished product">
              <Label>Made (actual quantity)</Label>
              {outputs.map((r) => lineRow(setOutputs, outputs, r, products, "Finished product"))}
              {products.length === 0 && (
                <p className="text-xs text-muted-foreground">No finished products yet. Add one under Stock items with type &ldquo;Finished product&rdquo;.</p>
              )}
              <div><Button type="button" variant="ghost" size="sm" onClick={() => setOutputs([...outputs, blank()])}>+ Another finished product</Button></div>
            </section>

            <section className="flex flex-col gap-2" aria-label="Ingredients used">
              <div className="flex items-center justify-between">
                <Label>Used (actual quantity)</Label>
                {!!suggestions?.length && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setInputs(suggestions.map((s) => blank({ ingredientId: s.ingredientId, unit: s.unit, hint: `${s.lastQuantity} ${s.unit}` })))}>
                    List what we used last time
                  </Button>
                )}
              </div>
              {inputs.map((r) => lineRow(setInputs, inputs, r, raw, "Ingredient"))}
              <div><Button type="button" variant="ghost" size="sm" onClick={() => setInputs([...inputs, blank()])}>+ Add ingredient</Button></div>
              {!!suggestions?.length && <p className="text-xs text-muted-foreground">The list only reminds you which ingredients were used. Type today&rsquo;s real quantities.</p>}
            </section>

            <section className="grid grid-cols-2 gap-3" aria-label="Details">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-when">Date and time</Label>
                <Input id="p-when" type="datetime-local" value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-shift">Shift</Label>
                <select id="p-shift" className={selectClass} value={shift} onChange={(e) => setShift(e.target.value)}>
                  <option value="">None</option>
                  {SHIFTS.map((s) => (<option key={s}>{s}</option>))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-loc">Kitchen / location</Label>
                <Input id="p-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main kitchen" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-ref">Batch number (optional)</Label>
                <Input id="p-ref" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="p-notes">Notes (optional)</Label>
                <Textarea id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              {correcting && (
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label htmlFor="p-reason">Why is this being corrected?</Label>
                  <Input id="p-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
            </section>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={review} disabled={busy}>{busy ? "Checking…" : "Review"}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">Check before posting. Stock changes only when you press Post.</p>
            <ReviewTable title="Will be taken out of stock" lines={preview?.lines.filter((l) => l.role === "INPUT") ?? []} sign="-" />
            <ReviewTable title="Will be added to stock" lines={preview?.lines.filter((l) => l.role === "OUTPUT") ?? []} sign="+" />
            {preview && !preview.canPost && (
              <p role="alert" className="text-sm text-destructive">There is not enough of at least one ingredient. Fix the stock count or the quantity first.</p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("form")}>Back</Button>
              <div className="flex gap-2">
                {!correcting && <Button type="button" variant="outline" onClick={draft} disabled={busy}>Save draft</Button>}
                <Button type="button" onClick={post} disabled={busy || !preview?.canPost}>{busy ? "Posting…" : correcting ? "Reverse old and post this" : "Post"}</Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewTable({ title, lines, sign }: { title: string; lines: PreviewLine[]; sign: "+" | "-" }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Item</th><th className="text-right font-medium">Quantity</th><th className="text-right font-medium">Now</th><th className="text-right font-medium">After</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.ingredientId} className="border-t border-border">
              <td className="py-1.5">{l.name}</td>
              <td className="text-right tabular-nums">{sign}{l.quantity} {l.unit}{l.entered !== `${l.quantity} ${l.unit}` ? <span className="block text-xs text-muted-foreground">typed {l.entered}</span> : null}</td>
              <td className="text-right tabular-nums text-muted-foreground">{l.balanceBefore}</td>
              <td className={`text-right tabular-nums ${l.short ? "font-semibold text-destructive" : ""}`}>{l.balanceAfter}{l.short ? ` (short by ${l.short})` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
