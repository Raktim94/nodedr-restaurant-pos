"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useMemo, useRef, useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type BatchBody, type MfgPreview, useMfgSettings, usePostBatch, usePrefill, usePreviewBatch } from "@/hooks/use-manufacturing";
import { useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

interface Row { key: number; ingredientId: string; quantity: string; unit: IngredientUnit | ""; rate: string }
interface Cost { key: number; category: string; description: string; amount: string; included: boolean }
let k = 1;
const blankRow = (o: Partial<Row> = {}): Row => ({ key: k++, ingredientId: "", quantity: "", unit: "", rate: "", ...o });
const COST_CATEGORIES = ["Labour", "Packaging", "Fuel & utilities", "Delivery into production area", "Other overhead"];
const STEPS = ["What", "Ingredients", "Other costs", "Cost & price", "Confirm"] as const;
const num = (v: string | null | undefined, dp = 2) => (v == null || v === "" ? "–" : Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const todayLocal = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// Guided, phone-first production batch with costing. One thing per screen; the primary action sits in a footer that
// stays above the keyboard; "Post" is on its own last step behind an explicit tick, apart from Back and Save draft.
// Every number you see in the cost and price steps was computed by the server from your quantities and rates.
export function ManufacturingBatchDialog({ branchId, open, onOpenChange }: { branchId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: items } = useStockItems(branchId);
  const { data: settings } = useMfgSettings(branchId);
  const prefill = usePrefill(branchId);
  const preview = usePreviewBatch(branchId);
  const { post, draft } = usePostBatch(branchId);
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<IngredientUnit | "">("");
  const [when, setWhen] = useState(todayLocal);
  const [batchRef, setBatchRef] = useState("");
  const [madeOn, setMadeOn] = useState("");
  const [expiry, setExpiry] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [priceMode, setPriceMode] = useState<"keep" | "new">("keep");
  const [newPrice, setNewPrice] = useState("");
  const [expected, setExpected] = useState<string | null>(null);
  const [pv, setPv] = useState<MfgPreview | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const key = useRef(""); // one key per batch, made on first use: a double tap or a retry cannot post twice
  const top = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const products = (items ?? []).filter((i) => i.kind === "PREPARED");
  const out = byId.get(product);
  const busy = post.isPending || draft.isPending || preview.isPending;

  const problem = (s: number): string | null => {
    if (s === 0 && (!product || !(Number(qty) > 0))) return "Choose the finished product and type how many were made.";
    if (s === 1) {
      const used = rows.filter((r) => r.ingredientId || r.quantity);
      if (!used.length) return "Add at least one ingredient that was used.";
      if (used.some((r) => !r.ingredientId || !(Number(r.quantity) > 0))) return "Every ingredient needs a quantity above zero.";
      if (used.some((r) => r.rate !== "" && !(Number(r.rate) >= 0))) return "A cost rate must be zero or more.";
    }
    if (s === 2 && costs.some((c) => (c.category.trim() === "" && c.amount !== "") || (c.amount !== "" && !(Number(c.amount) >= 0)))) return "Each cost needs a category and an amount of zero or more.";
    if (s === 3 && priceMode === "new" && !(Number(newPrice) > 0)) return "Type the new menu selling price, or choose to keep the current one.";
    return null;
  };

  const body = (): Pick<BatchBody, "inputs" | "outputs" | "costing"> & BatchBody => ({
    producedAt: new Date(when),
    batchRef: batchRef || undefined,
    manufacturedOn: madeOn ? new Date(madeOn) : undefined,
    expiryDate: expiry ? new Date(expiry) : undefined,
    inputs: rows.filter((r) => r.ingredientId).map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit, ...(r.rate.trim() !== "" ? { rate: r.rate.trim() } : {}) })),
    outputs: [{ ingredientId: product, quantity: qty.trim(), unit: unit as IngredientUnit }],
    costing: {
      enabled: true,
      costs: costs.filter((c) => c.category.trim() && c.amount !== "").map((c) => ({ category: c.category.trim(), description: c.description.trim() || undefined, amount: c.amount.trim(), included: c.included })),
      ...(priceMode === "new" && pv?.menuItem && expected !== null ? { menuPrice: { menuItemId: pv.menuItem.id, newPrice: newPrice.trim(), expectedCurrentPrice: expected } } : {}),
    },
  });

  const run = (then?: () => void) =>
    preview.mutate(body(), {
      onSuccess: (p) => { setPv(p); if (expected === null && p.currentPrice) setExpected(p.currentPrice); setError(null); then?.(); },
      onError: (e) => setError(e instanceof ApiError ? e.message : "Could not work that out. Nothing was changed."),
    });

  const go = (to: number) => { setStep(to); setTimeout(() => top.current?.scrollIntoView({ block: "start" }), 0); };
  const next = () => {
    const p = problem(step);
    if (p) { setError(p); return; }
    setError(null);
    if (step >= 2) return run(() => go(step + 1)); // the cost, price and confirm steps always show fresh server numbers
    go(step + 1);
  };

  const fillRecipe = () =>
    prefill.mutate({ ingredientId: product, quantity: qty || "1" }, {
      onSuccess: (r) => {
        if (!r.lines.length) return toast.error("This product's menu item has no recipe to fill from. Add the ingredients by hand.");
        setRows(r.lines.map((l) => blankRow({ ingredientId: l.ingredientId, quantity: l.quantity, unit: (byId.get(l.ingredientId)?.unit ?? "") as IngredientUnit })));
        toast.success(`Filled from the ${r.source}. Check every quantity: type what was really used.`);
      },
    });

  const reset = () => { setStep(0); setProduct(""); setQty(""); setUnit(""); setRows([blankRow()]); setCosts([]); setPriceMode("keep"); setNewPrice(""); setExpected(null); setPv(null); setAck(false); setError(null); setConflict(null); key.current = ""; };

  const submit = () => {
    setError(null);
    if (!key.current) key.current = `mfg-${crypto.randomUUID()}`;
    post.mutate({ ...body(), idempotencyKey: key.current }, {
      onSuccess: (r) => { toast.success(`Batch ${r.entryNo} posted${priceMode === "new" ? " and menu price updated" : ""}`); reset(); onOpenChange(false); },
      onError: (e) => {
        if (e instanceof ApiError && e.code === "PRICE_CONFLICT") {
          const m = /changed to ([\d.]+)/.exec(e.message);
          setConflict(m ? m[1] : "latest");
        }
        setError(e instanceof ApiError ? e.message : "The batch was not posted. Nothing was changed, and you can try again safely.");
      },
    });
  };
  const saveDraft = () => draft.mutate(body(), { onSuccess: (r) => { toast.success(`Saved as draft ${r.entryNo}. Stock has not changed.`); reset(); onOpenChange(false); }, onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save") });

  const setRow = (key2: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key2 ? { ...r, ...patch } : r)));
  const metric = (m: MfgPreview["proposedPriceMetrics"]) => (m ? (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-xs text-muted-foreground">Gross profit per unit</dt><dd className="font-semibold tabular-nums">{num(m.grossProfit)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Gross margin (of price)</dt><dd className="font-semibold tabular-nums">{m.marginPercent === null ? "–" : `${num(m.marginPercent)}%`}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Markup (on cost)</dt><dd className="font-semibold tabular-nums">{m.markupPercent === null ? "–" : `${num(m.markupPercent)}%`}</dd></div>
    </dl>
  ) : null);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92vh] sm:w-full sm:max-w-2xl sm:rounded-xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>New production batch</DialogTitle>
          <DialogDescription>Step {step + 1} of {STEPS.length}: {STEPS[step]}</DialogDescription>
          <ol className="mt-1 flex gap-1" aria-label="Progress">{STEPS.map((s, i) => (<li key={s} aria-current={i === step ? "step" : undefined} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />))}</ol>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div ref={top} />
          {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}{conflict && conflict !== "latest" && step === 4 && (
            <div className="mt-2"><Button size="sm" variant="outline" onClick={() => { setExpected(conflict); setConflict(null); setError(null); go(3); run(); }}>Review the latest price ({conflict})</Button></div>)}</div>}

          {step === 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5"><Label htmlFor="m-prod">Finished product</Label>
                <select id="m-prod" className={`${selectClass} h-11`} value={product} onChange={(e) => { setProduct(e.target.value); setUnit(byId.get(e.target.value)?.unit ?? ""); setExpected(null); setPv(null); }}>
                  <option value="">Choose…</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>
                {products.length === 0 && <p className="text-xs text-muted-foreground">No finished products yet. Add one under Stock items as &ldquo;Finished product&rdquo;.</p>}</div>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <div className="flex flex-col gap-1.5"><Label htmlFor="m-qty">Quantity made</Label><Input id="m-qty" className="h-11" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="m-unit">Unit</Label><select id="m-unit" className={`${selectClass} h-11`} value={unit} onChange={(e) => setUnit(e.target.value as IngredientUnit)}>{(out?.units ?? []).map((u) => (<option key={u}>{u}</option>))}</select></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="m-when">Production date and time</Label><Input id="m-when" className="h-11" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><Label htmlFor="m-made">Made on (optional)</Label><Input id="m-made" className="h-11" type="date" value={madeOn} onChange={(e) => setMadeOn(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="m-exp">Use by (optional)</Label><Input id="m-exp" className="h-11" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="m-ref">Batch number (optional)</Label><Input id="m-ref" className="h-11" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} /><p className="text-xs text-muted-foreground">The voucher number (PR-…) is given automatically when you post.</p></div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Type what this batch really used. The cost rate is per the item&rsquo;s stock unit; leave it empty to use the item&rsquo;s current average cost.</p>
              <Button type="button" variant="outline" className="h-11" disabled={prefill.isPending || !product} onClick={fillRecipe}>Fill from recipe (then adjust)</Button>
              {rows.map((r, i) => {
                const it = byId.get(r.ingredientId);
                return (
                  <fieldset key={r.key} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                    <legend className="px-1 text-xs text-muted-foreground">Ingredient {i + 1}</legend>
                    <Label className="sr-only" htmlFor={`i-${r.key}`}>Ingredient</Label>
                    <select id={`i-${r.key}`} className={`${selectClass} h-11`} value={r.ingredientId} onChange={(e) => setRow(r.key, { ingredientId: e.target.value, unit: byId.get(e.target.value)?.unit ?? "" })}>
                      <option value="">Choose ingredient…</option>{(items ?? []).filter((x) => x.id !== product).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
                    <div className="grid grid-cols-[1fr_6rem] gap-2">
                      <div className="flex flex-col gap-1"><Label htmlFor={`q-${r.key}`} className="text-xs">Quantity used</Label><Input id={`q-${r.key}`} className="h-11" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} /></div>
                      <div className="flex flex-col gap-1"><Label htmlFor={`u-${r.key}`} className="text-xs">Unit</Label><select id={`u-${r.key}`} className={`${selectClass} h-11`} value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value as IngredientUnit })}>{(it?.units ?? []).map((u) => (<option key={u}>{u}</option>))}</select></div>
                    </div>
                    <div className="flex flex-col gap-1"><Label htmlFor={`r-${r.key}`} className="text-xs">Cost rate per {it?.unit ?? "stock unit"} (optional)</Label><Input id={`r-${r.key}`} className="h-11" inputMode="decimal" value={r.rate} onChange={(e) => setRow(r.key, { rate: e.target.value })} placeholder="Average cost is used if empty" /></div>
                    {rows.length > 1 && <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Remove this ingredient</Button></div>}
                  </fieldset>
                );
              })}
              <Button type="button" variant="outline" className="h-11" onClick={() => setRows([...rows, blankRow()])}>+ Add ingredient</Button>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">Optional costs of this batch that are not ingredients. A cost marked <b>Count in product cost</b> is added to what the finished product cost. <b>Do not</b> also enter the same cost as a separate expense: this journal does not post to Accounting.</p>
              {costs.map((c) => (
                <fieldset key={c.key} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                  <legend className="px-1 text-xs text-muted-foreground">Cost</legend>
                  <Label htmlFor={`c-${c.key}`} className="text-xs">Category</Label>
                  <Input id={`c-${c.key}`} className="h-11" list="mfg-cats" value={c.category} onChange={(e) => setCosts(costs.map((x) => (x.key === c.key ? { ...x, category: e.target.value } : x)))} />
                  <Label htmlFor={`d-${c.key}`} className="text-xs">Note (optional)</Label>
                  <Input id={`d-${c.key}`} className="h-11" value={c.description} onChange={(e) => setCosts(costs.map((x) => (x.key === c.key ? { ...x, description: e.target.value } : x)))} />
                  <Label htmlFor={`a-${c.key}`} className="text-xs">Amount</Label>
                  <Input id={`a-${c.key}`} className="h-11" inputMode="decimal" value={c.amount} onChange={(e) => setCosts(costs.map((x) => (x.key === c.key ? { ...x, amount: e.target.value } : x)))} />
                  <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={c.included} onChange={(e) => setCosts(costs.map((x) => (x.key === c.key ? { ...x, included: e.target.checked } : x)))} /> Count in product cost</label>
                  <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setCosts(costs.filter((x) => x.key !== c.key))}>Remove this cost</Button></div>
                </fieldset>
              ))}
              <datalist id="mfg-cats">{COST_CATEGORIES.map((c) => (<option key={c} value={c} />))}</datalist>
              <Button type="button" variant="outline" className="h-11" onClick={() => setCosts([...costs, { key: k++, category: "", description: "", amount: "", included: true }])}>+ Add a cost</Button>
              {costs.length === 0 && <p className="text-xs text-muted-foreground">No other costs. You can continue.</p>}
            </div>
          )}

          {step === 3 && pv && (
            <div className="flex flex-col gap-5">
              <section aria-label="Production cost" className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Production cost (what this batch cost)</h3>
                <dl className="mt-2 flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between"><dt>Ingredient cost</dt><dd className="tabular-nums">{num(pv.ingredientCost)}</dd></div>
                  <div className="flex justify-between"><dt>Additional production costs (counted)</dt><dd className="tabular-nums">{num(pv.additionalCost)}</dd></div>
                  <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt>Total cost for this batch</dt><dd className="tabular-nums">{num(pv.totalCost)}</dd></div>
                  <div className="flex justify-between"><dt>Finished quantity</dt><dd className="tabular-nums">{pv.finished.quantity} {pv.finished.unit}</dd></div>
                  <div className="flex justify-between text-base font-semibold"><dt>Cost per finished unit</dt><dd className="tabular-nums">{num(pv.unitCost, 4)}</dd></div>
                </dl>
                <ul className="mt-3 divide-y divide-border text-sm">{pv.lines.map((l) => (<li key={l.ingredientId} className="flex justify-between gap-3 py-1.5"><span>{l.name}<span className="block text-xs text-muted-foreground">{l.quantity} {l.unit} × {num(l.rate, 4)} ({l.rateSource})</span></span><span className="tabular-nums">{num(l.lineCost)}</span></li>))}</ul>
                {pv.shortages.length > 0 && <p role="alert" className="mt-2 text-sm text-destructive">Not enough stock of: {pv.shortages.join(", ")}. Fix the count or the quantity before posting.</p>}
                <p className="mt-2 text-xs text-muted-foreground">Rounding: each ingredient line is rounded to 4 decimals, the cost per unit is rounded to 4 decimals, and the batch total is the figure that is kept.</p>
              </section>

              <section aria-label="Menu selling price" className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Menu selling price (what the customer pays)</h3>
                <p className="mt-1 text-xs text-muted-foreground">This is a different number from the production cost above. Prices on the menu include tax. Changing it affects future orders only; bills already made are not changed.</p>
                {!pv.menuItem ? (
                  <p className="mt-2 text-sm text-muted-foreground">This product is not linked to a menu item, so there is no selling price to set here. Link it under Menu &gt; Edit item &gt; Stock when sold.</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex justify-between text-sm"><span>{pv.menuItem.name}: current menu price</span><span className="font-semibold tabular-nums">{num(pv.currentPrice)}</span></div>
                    {metric(pv.currentPriceMetrics)}
                    {settings?.canPrice ? (
                      <fieldset className="flex flex-col gap-2">
                        <legend className="sr-only">Menu price</legend>
                        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="radio" className="size-5" checked={priceMode === "keep"} onChange={() => { setPriceMode("keep"); setPv({ ...pv, proposedPrice: null, proposedPriceMetrics: null }); }} /> Keep the current price</label>
                        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm"><input type="radio" className="size-5" checked={priceMode === "new"} onChange={() => setPriceMode("new")} /> Set a new menu price</label>
                        {priceMode === "new" && (
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="m-newprice">New menu selling price (tax included)</Label>
                            <div className="flex gap-2"><Input id="m-newprice" className="h-11" inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} /><Button type="button" variant="outline" className="h-11" disabled={busy || !(Number(newPrice) > 0)} onClick={() => run()}>Show margin</Button></div>
                            {pv.proposedPrice && metric(pv.proposedPriceMetrics)}
                            <p className="text-xs text-muted-foreground">Nothing changes until you post the batch on the last step.</p>
                          </div>
                        )}
                      </fieldset>
                    ) : <p className="text-sm text-muted-foreground">Changing the menu price needs the menu price permission. You can post the batch without it.</p>}
                  </div>
                )}
              </section>
            </div>
          )}

          {step === 4 && pv && (
            <div className="flex flex-col gap-4">
              <section className="rounded-xl border border-border p-4 text-sm">
                <h3 className="font-semibold">You are about to post</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Take out of stock: {pv.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(", ")}.</li>
                  <li>Add to stock: {pv.finished.quantity} {pv.finished.unit} {pv.finished.name}, at a cost of {num(pv.unitCost, 4)} each (batch total {num(pv.totalCost)}).</li>
                  {priceMode === "new" && pv.menuItem ? <li><b>Change the menu price</b> of {pv.menuItem.name} from {num(pv.currentPrice)} to {num(newPrice)} for future orders.</li> : <li>The menu price stays as it is.</li>}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Posting cannot be edited afterwards. A mistake is fixed by a reversal with a reason, which keeps the history.</p>
              </section>
              <label className="flex min-h-12 items-start gap-3 rounded-lg border border-border p-3 text-sm"><input type="checkbox" className="mt-0.5 size-5" checked={ack} onChange={(e) => setAck(e.target.checked)} /> <span>I checked the quantities and costs and I want to post this batch{priceMode === "new" ? " and change the menu price" : ""}.</span></label>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {step < 4 ? (
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" className="h-12 flex-1" disabled={busy} onClick={() => (step === 0 ? onOpenChange(false) : go(step - 1))}>{step === 0 ? "Cancel" : "Back"}</Button>
              <Button type="button" className="h-12 flex-[2]" disabled={busy} onClick={next}>{preview.isPending ? "Working it out…" : "Next"}</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Button type="button" className="h-12 w-full" disabled={busy || !ack || !pv?.canPost || !settings?.canPost} onClick={submit}>{post.isPending ? "Posting…" : "Post batch"}</Button>
              {!settings?.canPost && <p className="text-xs text-muted-foreground">You can save a draft; a manager needs to post it.</p>}
              <div className="flex gap-3 pt-1">
                <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => go(3)}>Back</Button>
                <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={saveDraft}>Save as draft</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
