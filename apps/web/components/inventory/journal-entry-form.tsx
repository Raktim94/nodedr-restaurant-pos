"use client";

import type { IngredientUnit, StockJournalType, WasteReason } from "@nodedr-restaurant/types";
import { ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { SearchSelect } from "@/components/ui/search-select";
import { WASTE_REASONS } from "@/components/inventory/log-waste-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type JournalEntry, type StockItem, useJournalEntryActions, usePlaceMatrix, usePlaces, useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export const JOURNAL_TYPES: Record<StockJournalType, { label: string; short: string; help: string }> = {
  TRANSFER: {
    label: "Stock transfer",
    short: "Transfer",
    help: "Move stock from one place to another, e.g. dry store to kitchen. The total you own does not change.",
  },
  WASTE: {
    label: "Waste or spoilage",
    short: "Waste",
    help: "Stock that was thrown away: spoiled, expired, dropped. It leaves stock and shows in the Waste reports.",
  },
  CORRECTION: {
    label: "Stock correction",
    short: "Correction",
    help: "The count on the shelf differs from the system. Add or remove the difference and say why.",
  },
};

interface Row {
  key: number;
  ingredientId: string;
  quantity: string;
  unit: IngredientUnit | "";
  direction: "OUT" | "IN";
  from: string; // "" = unassigned / not stated
  to: string;
  wasteReason: WasteReason | "";
  note: string;
}
let seq = 1;
const blank = (o: Partial<Row> = {}): Row => ({ key: seq++, ingredientId: "", quantity: "", unit: "", direction: "OUT", from: "", to: "", wasteReason: "", note: "", ...o });
const localNow = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const q3 = (n: number) => String(Math.round(n * 1000) / 1000);
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Only the item's own unit can be compared with what is in stock; other units are converted by the server.
const UNIT_FACTOR: Partial<Record<string, Partial<Record<string, number>>>> = { KG: { G: 0.001 }, L: { ML: 0.001 }, DOZEN: { PIECE: 1 / 12 }, PIECE: { DOZEN: 12 } };
const inBase = (qty: number, unit: string, base: string) => (unit === base ? qty : UNIT_FACTOR[base]?.[unit] != null ? qty * UNIT_FACTOR[base]![unit]! : null);

type FieldErrors = Record<string, string>;
const drop = (e: FieldErrors, k: string) => Object.fromEntries(Object.entries(e).filter(([f]) => f !== k));

/**
 * The form behind "New stock journal" for transfers, waste and corrections: details, item rows, then a review that
 * shows exactly what leaves and enters stock before anything is posted. Production uses the voucher instead.
 */
export function JournalEntryForm({
  branchId,
  type,
  draft,
  onDone,
  onCancel,
}: {
  branchId: string | null;
  type: StockJournalType;
  draft?: JournalEntry;
  onDone: (e: JournalEntry, posted: boolean) => void;
  onCancel: () => void;
}) {
  const { data: items, isLoading: itemsLoading } = useStockItems(branchId);
  const { data: places } = usePlaces(branchId);
  const { data: matrix } = usePlaceMatrix(branchId);
  const act = useJournalEntryActions(branchId);
  const meta = JOURNAL_TYPES[type];

  const [when, setWhen] = useState(() => (draft ? localNow(new Date(draft.occurredAt)) : localNow()));
  // Latest allowed time (a few minutes of clock drift is fine), fixed when the form opens.
  const [maxWhen] = useState(() => localNow(new Date(Date.now() + 5 * 60_000)));
  const [reason, setReason] = useState(draft?.reason ?? "");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    draft?.lines.length
      ? draft.lines.map((l) => blank({ ingredientId: l.ingredientId, quantity: l.enteredQuantity, unit: l.enteredUnit, direction: l.direction, from: l.fromLocationId ?? "", to: l.toLocationId ?? "", wasteReason: l.wasteReason ?? "", note: l.note ?? "" }))
      : [blank()],
  );
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const key = useRef(`web-sj-${crypto.randomUUID()}`); // one key per form: a double click or retry saves once

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const activePlaces = (places ?? []).filter((p) => p.isActive);
  const placeName = (id: string) => activePlaces.find((p) => p.id === id)?.name ?? null;
  const levelAt = (itemId: string, placeId: string) => {
    const row = matrix?.items.find((i) => i.id === itemId);
    if (!row) return null;
    return Number(placeId ? (row.levels[placeId] ?? 0) : row.unassigned);
  };
  const busy = act.create.isPending || act.update.isPending || act.post.isPending;
  const used = rows.filter((r) => r.ingredientId || r.quantity);
  const canCost = (items ?? []).some((i) => i.costPerUnit !== undefined);

  const patch = (k: number, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([f]) => !f.startsWith(`${k}.`))));
  };
  const pickItem = (k: number, id: string) => patch(k, { ingredientId: id, unit: byId.get(id)?.unit ?? "" });

  /** Field-level checks the server repeats. Returns errors keyed `<rowKey>.<field>` or a header field name. */
  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!when || Number.isNaN(new Date(when).getTime())) e.when = "Choose the date and time";
    else if (when > maxWhen) e.when = "This is in the future";
    if (type === "CORRECTION" && reason.trim().length < 3) e.reason = "Say why the stock was wrong";
    if (!used.length) e[`${rows[0].key}.item`] = "Choose at least one item";
    const seen = new Set<string>();
    for (const r of used) {
      if (!r.ingredientId) e[`${r.key}.item`] = "Choose an item";
      const n = Number(r.quantity);
      if (!r.quantity.trim()) e[`${r.key}.qty`] = "Enter a quantity";
      else if (!Number.isFinite(n) || n <= 0) e[`${r.key}.qty`] = "Must be more than zero";
      else if (!/^\d+(\.\d{1,3})?$/.test(r.quantity.trim())) e[`${r.key}.qty`] = "Up to 3 decimals";
      if (type === "TRANSFER") {
        if (!r.to) e[`${r.key}.to`] = "Choose where it goes";
        else if (r.to === r.from) e[`${r.key}.to`] = "Must differ from From";
      }
      if (type === "WASTE") {
        if (!r.wasteReason) e[`${r.key}.reason`] = "Choose a reason";
        else if (r.wasteReason === "OTHER" && r.note.trim().length < 3) e[`${r.key}.note`] = "Say what happened";
      }
      const k = `${r.ingredientId}:${type === "TRANSFER" ? `${r.from}>${r.to}` : ""}`;
      if (r.ingredientId && seen.has(k)) e[`${r.key}.item`] = "Listed twice; combine into one row";
      seen.add(k);
    }
    return e;
  };

  // What each row does to stock, with shortages against what the system holds (same unit only).
  const effects = used.map((r) => {
    const it = byId.get(r.ingredientId);
    const n = Number(r.quantity) || 0;
    const base = it ? inBase(n, r.unit, it.unit) : null;
    let available: number | null = null;
    let where = "in stock";
    if (it && type === "TRANSFER") { available = levelAt(it.id, r.from); where = r.from ? `in ${placeName(r.from)}` : "not yet placed"; }
    else if (it && r.direction === "OUT" && r.from && matrix) { available = levelAt(it.id, r.from); where = `in ${placeName(r.from)}`; }
    else if (it && r.direction === "OUT") available = Number(it.currentStock);
    const short = base != null && available != null && base > available + 1e-9;
    // An item with no cost yet (average 0) has an unknown value, not a value of zero.
    const cost = it?.costPerUnit && Number(it.costPerUnit) > 0 && base != null ? Number(it.costPerUnit) * base : null;
    return { r, it, base, available, where, short, cost };
  });
  const leaving = effects.filter((x) => x.r.direction === "OUT");
  const entering = effects.filter((x) => x.r.direction === "IN");
  const shortages = effects.filter((x) => x.short);
  const valueImpact = type === "TRANSFER" || !canCost || effects.some((x) => x.cost == null) ? null : effects.reduce((a, x) => a + (x.r.direction === "IN" ? 1 : -1) * (x.cost ?? 0), 0);
  const placesTouched = [...new Set(effects.flatMap((x) => [x.r.from ? placeName(x.r.from) : type === "TRANSFER" ? "Not yet placed" : null, x.r.to ? placeName(x.r.to) : null]).filter((p): p is string => !!p))];

  const body = () => ({
    type,
    occurredAt: new Date(when),
    reason: reason.trim() || undefined,
    notes: notes.trim() || undefined,
    lines: used.map((r) => ({
      ingredientId: r.ingredientId,
      quantity: r.quantity.trim(),
      unit: r.unit as IngredientUnit,
      direction: type === "CORRECTION" ? r.direction : ("OUT" as const),
      ...(r.from ? { fromLocationId: r.from } : {}),
      ...((type === "TRANSFER" || r.direction === "IN") && r.to ? { toLocationId: r.to } : {}),
      ...(type === "WASTE" && r.wasteReason ? { wasteReason: r.wasteReason } : {}),
      ...(r.note.trim() ? { note: r.note.trim() } : {}),
    })),
  });

  const check = () => {
    const e = validate();
    setErrors(e);
    setServerError(null);
    if (Object.keys(e).length) {
      // Move focus to the first problem so keyboard and screen-reader users land on it.
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return false;
    }
    return true;
  };
  const fail = (e: unknown) => setServerError(e instanceof ApiError ? e.message : "Could not save. Nothing was changed. Check the connection and try again.");

  const save = (post: boolean) => {
    if (!check()) { setStep("edit"); return; }
    if (draft) {
      act.update.mutate({ id: draft.id, body: body() }, {
        onSuccess: (e) => (post ? act.post.mutate(e.id, { onSuccess: (p) => onDone(p, true), onError: (er) => { setConfirming(false); fail(er); } }) : onDone(e, false)),
        onError: (er) => { setConfirming(false); fail(er); },
      });
    } else {
      act.create.mutate({ ...body(), idempotencyKey: `${key.current}${post ? "-p" : "-d"}`, post }, {
        onSuccess: (e) => onDone(e, post),
        onError: (er) => { setConfirming(false); fail(er); },
      });
    }
  };

  const err = (k: number, f: string) => errors[`${k}.${f}`];
  const errId = (k: number, f: string) => (err(k, f) ? `err-${k}-${f}` : undefined);
  const fieldError = (k: number, f: string) => (err(k, f) ? <p id={`err-${k}-${f}`} className="mt-1 text-xs text-destructive">{err(k, f)}</p> : null);

  const placeSelect = (id: string, value: string, onChange: (v: string) => void, empty: string, invalid?: boolean, describedBy?: string) => (
    <SearchSelect id={id} value={value} onChange={onChange} invalid={invalid} aria-describedby={describedBy} placeholder={empty} emptyText="No place matches"
      options={[{ value: "", label: empty }, ...activePlaces.map((p) => ({ value: p.id, label: p.name }))]} />
  );

  if (step === "review") {
    return (
      <section aria-labelledby="sj-review-title" className="flex flex-col gap-5">
        <div>
          <h2 id="sj-review-title" className="text-lg font-semibold">Review {meta.label.toLowerCase()}</h2>
          <p className="text-sm text-muted-foreground">Nothing has changed yet. <b className="text-foreground">Posting updates stock straight away</b>; a posted entry cannot be edited, only reversed.</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="font-medium">{meta.label}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Date and time</dt><dd>{new Date(when).toLocaleString()}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Reference</dt><dd>{draft?.entryNo ?? "Given when saved"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Places affected</dt><dd>{placesTouched.length ? placesTouched.join(", ") : "None stated"}</dd></div>
          {reason.trim() && <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-muted-foreground">{type === "CORRECTION" ? "Reason" : "Purpose"}</dt><dd>{reason}</dd></div>}
        </dl>

        {type === "TRANSFER" ? (
          <ReviewTable title="Moving" caption="The item's total does not change.">
            {effects.map(({ r, it }) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1 font-medium">{it?.name}</span>
                <span className="tabular-nums">{r.quantity} {r.unit}</span>
                <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground sm:w-auto">{r.from ? placeName(r.from) : "Not yet placed"} <ArrowRight aria-label="to" className="size-3.5" /> <b className="text-foreground">{placeName(r.to)}</b></span>
              </li>
            ))}
          </ReviewTable>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <ReviewTable title="Leaving stock" tone="out" empty="Nothing leaves stock.">
              {leaving.map(({ r, it, cost }) => (
                <li key={r.key} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1"><span className="font-medium">{it?.name}</span>{(r.from || r.wasteReason) && <span className="block text-xs text-muted-foreground">{[r.wasteReason && WASTE_REASONS.find((w) => w.value === r.wasteReason)?.label, r.from && `from ${placeName(r.from)}`].filter(Boolean).join(" · ")}</span>}</span>
                  <span className="tabular-nums text-destructive">−{r.quantity} {r.unit}</span>
                  {cost != null && <span className="w-full text-right text-xs tabular-nums text-muted-foreground">{money(cost)}</span>}
                </li>
              ))}
            </ReviewTable>
            <ReviewTable title="Entering stock" tone="in" empty="Nothing enters stock.">
              {entering.map(({ r, it, cost }) => (
                <li key={r.key} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1"><span className="font-medium">{it?.name}</span>{r.to && <span className="block text-xs text-muted-foreground">into {placeName(r.to)}</span>}</span>
                  <span className="tabular-nums text-success">+{r.quantity} {r.unit}</span>
                  {cost != null && <span className="w-full text-right text-xs tabular-nums text-muted-foreground">{money(cost)}</span>}
                </li>
              ))}
            </ReviewTable>
          </div>
        )}

        {valueImpact != null && (
          <p className="text-sm">Value impact at average cost: <b className={cn("tabular-nums", valueImpact < 0 ? "text-destructive" : "text-success")}>{valueImpact > 0 ? "+" : ""}{money(valueImpact)}</b> <span className="text-muted-foreground">(estimate; the figure is fixed when posted)</span></p>
        )}
        {shortages.length > 0 && (
          <div role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <p className="font-medium">Not enough stock to post:</p>
            <ul className="mt-1 list-disc pl-5">{shortages.map(({ r, it, available, where }) => <li key={r.key}>{it?.name}: {r.quantity} {r.unit} needed, {q3(available ?? 0)} {it?.unit} {where}</li>)}</ul>
            <p className="mt-1">Stock never goes below zero. Fix the quantity, choose another place, or save a draft and count first.</p>
          </div>
        )}
        {serverError && <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{serverError}</p>}

        <div className="sticky bottom-0 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-col-reverse gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={() => setStep("edit")} disabled={busy}>Back to edit</Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => save(false)} disabled={busy}>{act.create.isPending || act.update.isPending ? "Saving…" : "Save draft"}</Button>
            <Button onClick={() => setConfirming(true)} disabled={busy || shortages.length > 0}>Post journal</Button>
          </div>
        </div>

        <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Post this {meta.short.toLowerCase()}?</DialogTitle>
              <DialogDescription>
                {type === "TRANSFER" ? `${effects.length} item${effects.length === 1 ? "" : "s"} will move between places now.` : `Stock changes now: ${leaving.length} leaving, ${entering.length} entering.`} You cannot edit it after posting; a manager can reverse it.
              </DialogDescription>
            </DialogHeader>
            {serverError && <p role="alert" className="text-sm text-destructive">{serverError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Not yet</Button>
              <Button onClick={() => save(true)} disabled={busy} autoFocus>{busy ? "Posting…" : "Post and update stock"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => { e.preventDefault(); if (check()) setStep("review"); }}
    >
      <section aria-labelledby="sj-details" className="flex flex-col gap-3">
        <div>
          <h2 id="sj-details" className="text-base font-semibold">1. Journal details</h2>
          <p className="text-sm text-muted-foreground">{meta.help}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sj-when">Date and time</Label>
            <Input id="sj-when" type="datetime-local" value={when} max={maxWhen} onChange={(e) => { setWhen(e.target.value); setErrors((x) => drop(x, "when")); }} aria-invalid={!!errors.when || undefined} aria-describedby={errors.when ? "err-when" : undefined} className="h-10" />
            {errors.when && <p id="err-when" className="text-xs text-destructive">{errors.when}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">Reference no.</span>
            <p className="flex h-10 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground">{draft?.entryNo ?? "Given when saved"}</p>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="sj-reason">{type === "CORRECTION" ? "Reason (required)" : type === "WASTE" ? "What happened (optional)" : "Purpose (optional)"}</Label>
            <Input id="sj-reason" value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); setErrors((x) => drop(x, "reason")); }} placeholder={type === "CORRECTION" ? "e.g. Weekly count, found 2 kg less rice" : type === "WASTE" ? "e.g. Fridge 2 failed overnight" : "e.g. Issue for dinner service"} aria-invalid={!!errors.reason || undefined} aria-describedby={errors.reason ? "err-reason" : undefined} className="h-10" />
            {errors.reason && <p id="err-reason" className="text-xs text-destructive">{errors.reason}</p>}
          </div>
        </div>
      </section>

      <section aria-labelledby="sj-items" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="sj-items" className="text-base font-semibold">2. Items</h2>
            <p className="text-sm text-muted-foreground">
              {type === "TRANSFER" ? "For each item: how much, where it is now and where it goes." : type === "WASTE" ? "What was thrown away, how much, and why." : "Choose Remove when there is less on the shelf than the system says, Add when there is more."}
            </p>
          </div>
        </div>
        {itemsLoading ? (
          <div className="h-28 animate-pulse rounded-xl bg-muted" aria-label="Loading items" />
        ) : (items ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No stock items yet. Add them under <a className="font-medium text-foreground underline" href="/inventory">Stock items</a> first.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {rows.map((r, idx) => {
              const it = byId.get(r.ingredientId);
              const eff = effects.find((x) => x.r.key === r.key);
              return (
                <li key={r.key} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove item ${idx + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 className="size-4" /></Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <ItemCombobox items={items ?? []} value={r.ingredientId} onChange={(id) => pickItem(r.key, id)} label={`Item ${idx + 1}`} invalid={!!err(r.key, "item")} describedBy={errId(r.key, "item")} autoFocus={idx > 0 && !r.ingredientId} />
                      {fieldError(r.key, "item")}
                      {it && <p className="mt-1 text-xs text-muted-foreground">In stock: <span className="tabular-nums">{it.currentStock} {it.unit.toLowerCase()}</span>{eff?.available != null && (type === "TRANSFER" || r.from) ? <> · {eff.where}: <span className={cn("tabular-nums", eff.short && "font-semibold text-destructive")}>{q3(eff.available)} {it.unit.toLowerCase()}</span></> : null}</p>}
                    </div>
                    {type === "CORRECTION" && (
                      <fieldset className="md:col-span-3">
                        <legend className="sr-only">Direction for item {idx + 1}</legend>
                        <div className="grid h-10 grid-cols-2 rounded-lg border border-input p-0.5 text-sm">
                          {(["OUT", "IN"] as const).map((d) => (
                            <label key={d} className={cn("flex cursor-pointer items-center justify-center gap-1 rounded-md font-medium transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50", r.direction === d ? (d === "OUT" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success") : "text-muted-foreground hover:text-foreground")}>
                              <input type="radio" className="sr-only" name={`dir-${r.key}`} checked={r.direction === d} onChange={() => patch(r.key, { direction: d, ...(d === "OUT" ? { to: "" } : { from: "" }) })} />
                              {d === "OUT" ? <Minus aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}{d === "OUT" ? "Remove" : "Add"}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <div className={cn("grid grid-cols-[1fr_6.5rem] gap-2", type === "CORRECTION" ? "md:col-span-4" : "md:col-span-4")}>
                      <div>
                        <Label htmlFor={`q-${r.key}`} className="sr-only">Quantity for item {idx + 1}</Label>
                        <Input id={`q-${r.key}`} inputMode="decimal" placeholder={type === "TRANSFER" ? "Quantity to move" : type === "WASTE" ? "Quantity wasted" : "Difference"} value={r.quantity} onChange={(e) => patch(r.key, { quantity: e.target.value.replace(",", ".") })} aria-invalid={!!err(r.key, "qty") || undefined} aria-describedby={errId(r.key, "qty")} className="h-10 tabular-nums" />
                        {fieldError(r.key, "qty")}
                      </div>
                      <div>
                        <Label htmlFor={`u-${r.key}`} className="sr-only">Unit for item {idx + 1}</Label>
                        <SearchSelect id={`u-${r.key}`} value={r.unit} disabled={!it} placeholder="Unit" onChange={(v) => v && patch(r.key, { unit: v as IngredientUnit })}
                          options={(it?.units ?? []).map((u) => ({ value: u, label: u.toLowerCase() }))} />
                      </div>
                    </div>
                    {type !== "CORRECTION" && <div className="hidden md:col-span-3 md:block" />}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {type === "TRANSFER" && (
                      <>
                        <div className="flex flex-col gap-1.5"><Label htmlFor={`f-${r.key}`}>From</Label>{placeSelect(`f-${r.key}`, r.from, (v) => patch(r.key, { from: v }), "Not yet placed anywhere")}</div>
                        <div className="flex flex-col gap-1.5"><Label htmlFor={`t-${r.key}`}>To</Label>{placeSelect(`t-${r.key}`, r.to, (v) => patch(r.key, { to: v }), "Choose a place…", !!err(r.key, "to"), errId(r.key, "to"))}{fieldError(r.key, "to")}</div>
                      </>
                    )}
                    {type === "WASTE" && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`r-${r.key}`}>Reason</Label>
                          <SearchSelect id={`r-${r.key}`} value={r.wasteReason} placeholder="Choose or type a reason…" onChange={(v) => patch(r.key, { wasteReason: v as WasteReason })} invalid={!!err(r.key, "reason")} aria-describedby={errId(r.key, "reason")}
                            options={WASTE_REASONS.map((w) => ({ value: w.value, label: w.label }))} />
                          {fieldError(r.key, "reason")}
                        </div>
                        {activePlaces.length > 0 && <div className="flex flex-col gap-1.5"><Label htmlFor={`f-${r.key}`}>Taken from (optional)</Label>{placeSelect(`f-${r.key}`, r.from, (v) => patch(r.key, { from: v }), "Not stated")}</div>}
                      </>
                    )}
                    {type === "CORRECTION" && activePlaces.length > 0 && (
                      r.direction === "OUT"
                        ? <div className="flex flex-col gap-1.5"><Label htmlFor={`f-${r.key}`}>Place (optional)</Label>{placeSelect(`f-${r.key}`, r.from, (v) => patch(r.key, { from: v }), "Not stated")}</div>
                        : <div className="flex flex-col gap-1.5"><Label htmlFor={`t-${r.key}`}>Place (optional)</Label>{placeSelect(`t-${r.key}`, r.to, (v) => patch(r.key, { to: v }), "Not stated")}</div>
                    )}
                    <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
                      <Label htmlFor={`n-${r.key}`}>Note {type === "WASTE" && r.wasteReason === "OTHER" ? "(required)" : "(optional)"}</Label>
                      <Input id={`n-${r.key}`} value={r.note} maxLength={300} onChange={(e) => patch(r.key, { note: e.target.value })} aria-invalid={!!err(r.key, "note") || undefined} aria-describedby={errId(r.key, "note")} className="h-10" />
                      {fieldError(r.key, "note")}
                    </div>
                  </div>
                  {eff?.cost != null && type !== "TRANSFER" && <p className="mt-2 text-right text-xs text-muted-foreground">≈ {money(eff.cost)} at average cost</p>}
                </li>
              );
            })}
          </ol>
        )}
                <Button type="button" variant="outline" className="self-start" onClick={() => setRows((rs) => [...rs, blank(type === "TRANSFER" && rs.length ? { from: rs[rs.length - 1].from, to: rs[rs.length - 1].to } : type === "WASTE" && rs.length ? { wasteReason: rs[rs.length - 1].wasteReason } : {})])}>
          <Plus aria-hidden className="size-4" /> Add another item
        </Button>
        {type === "TRANSFER" && activePlaces.length < 2 && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">You need at least two places to transfer between. Set them up under <a className="font-medium underline" href="/inventory/areas">Areas</a>.</p>
        )}
      </section>

      <section aria-labelledby="sj-notes" className="flex flex-col gap-1.5">
        <h2 id="sj-notes" className="sr-only">Notes</h2>
        <Label htmlFor="sj-notes-input">Notes (optional)</Label>
        <Textarea id="sj-notes-input" value={notes} maxLength={1000} rows={2} onChange={(e) => setNotes(e.target.value)} placeholder="Anything a manager should know when checking this entry" />
      </section>

      {serverError && <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{serverError}</p>}

      <div className="sticky bottom-0 max-lg:bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-col-reverse gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <span className="hidden text-xs text-muted-foreground lg:inline">A draft changes no stock.</span>
          <Button type="button" variant="outline" onClick={() => save(false)} disabled={busy}>{act.create.isPending || act.update.isPending ? "Saving…" : "Save draft"}</Button>
          <Button type="submit" disabled={busy}>Review and post</Button>
        </div>
      </div>
    </form>
  );
}

function ReviewTable({ title, caption, tone, empty, children }: { title: string; caption?: string; tone?: "in" | "out"; empty?: string; children: React.ReactNode[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <h3 className={cn("flex items-center justify-between border-b border-border px-4 py-2 text-sm font-semibold", tone === "out" ? "bg-destructive/5" : tone === "in" ? "bg-success/5" : "bg-muted/40")}>
        {title}{caption && <span className="text-xs font-normal text-muted-foreground">{caption}</span>}
      </h3>
      {children.length ? <ul className="divide-y divide-border text-sm">{children}</ul> : <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

export type { StockItem };
