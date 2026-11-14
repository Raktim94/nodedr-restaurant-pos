"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useMemo, useRef, useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type BatchBody, type MfgPreview, type QualityResult, useMfgSettings, usePostBatch, usePrefill, usePreviewBatch, useRecordQuality } from "@/hooks/use-manufacturing";
import { useSaveProduction, usePreviewProduction, useStockItems } from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

interface In { key: number; ingredientId: string; quantity: string; unit: IngredientUnit | ""; rate: string; expected?: string }
interface Out { key: number; ingredientId: string; quantity: string; unit: IngredientUnit | "" }
interface Cost { key: number; category: string; amount: string }
let k = 1;
const blankIn = (o: Partial<In> = {}): In => ({ key: k++, ingredientId: "", quantity: "", unit: "", rate: "", ...o });
const blankOut = (o: Partial<Out> = {}): Out => ({ key: k++, ingredientId: "", quantity: "", unit: "", ...o });
const SHIFTS = ["Morning", "Afternoon", "Evening", "Night"];
const COST_CATEGORIES = ["Labour", "Packaging", "Fuel & utilities", "Other overhead"];
const money = (v: number | string | null | undefined) => (v == null || v === "" || Number.isNaN(Number(v)) ? "–" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const local = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
type RLine = { role: "INPUT" | "OUTPUT"; ingredientId: string; name: string; quantity: string; unit: string; rate?: string | null; lineCost?: string | null };
const head = "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground";

/**
 * Stock journal voucher (manufacturing entry). Source / Consumption on the left, Destination / Production on the
 * right, side by side from the lg breakpoint and stacked (source first) below it. Quantities are what really
 * happened; amounts are worked out by the server in the review step and frozen when posted. The menu selling price
 * is never touched here.
 */
export function StockJournalVoucher({ branchId, open, onOpenChange, productId }: { branchId: string | null; open: boolean; onOpenChange: (o: boolean) => void; productId?: string }) {
  const { data: items } = useStockItems(branchId);
  const { data: settings } = useMfgSettings(branchId);
  const prefill = usePrefill(branchId);
  const mfgPreview = usePreviewBatch(branchId);
  const plainPreview = usePreviewProduction(branchId);
  const { post: mfgPost } = usePostBatch(branchId);
  const plainSave = useSaveProduction(branchId);
  const quality = useRecordQuality(branchId);
  const [when, setWhen] = useState(local);
  const [batchRef, setBatchRef] = useState("");
  const [location, setLocation] = useState("");
  const [shift, setShift] = useState("");
  const [madeOn, setMadeOn] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [ins, setIns] = useState<In[]>([blankIn()]);
  const [outs, setOuts] = useState<Out[]>([blankOut(productId ? { ingredientId: productId } : {})]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [qResult, setQResult] = useState<QualityResult | "">("");
  const [qGrade, setQGrade] = useState("");
  const [qNotes, setQNotes] = useState("");
  const [review, setReview] = useState<{ lines: RLine[]; canPost: boolean; shortages: string[]; mfg: MfgPreview | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const raw = (items ?? []).filter((i) => i.kind === "PURCHASED");
  const products = (items ?? []).filter((i) => i.kind === "PREPARED");
  const costed = !!settings?.enabled && outs.length === 1;
  const busy = mfgPreview.isPending || plainPreview.isPending || mfgPost.isPending || plainSave.isPending;
  const patchIn = (id: number, p: Partial<In>) => setIns((r) => r.map((x) => (x.key === id ? { ...x, ...p } : x)));
  const patchOut = (id: number, p: Partial<Out>) => setOuts((r) => r.map((x) => (x.key === id ? { ...x, ...p } : x)));
  const pickIn = (id: number, ing: string) => patchIn(id, { ingredientId: ing, unit: byId.get(ing)?.unit ?? "", expected: undefined });
  const pickOut = (id: number, ing: string) => patchOut(id, { ingredientId: ing, unit: byId.get(ing)?.unit ?? "" });
  if (productId && outs[0]?.ingredientId === productId && !outs[0].unit && byId.get(productId)) patchOut(outs[0].key, { unit: byId.get(productId)!.unit });

  const usedIns = ins.filter((r) => r.ingredientId || r.quantity);
  const usedOuts = outs.filter((r) => r.ingredientId || r.quantity);
  const estimate = usedIns.reduce((s, r) => s + (Number(r.quantity) > 0 && r.rate !== "" ? Number(r.quantity) * Number(r.rate) : 0), 0);
  const extra = costs.reduce((s, c) => s + (Number(c.amount) > 0 ? Number(c.amount) : 0), 0);
  // Quick shortage hint while typing (same unit only); the server check in Review is the real one.
  const short = (r: In) => { const it = byId.get(r.ingredientId); return !!it && r.unit === it.unit && Number(r.quantity) > Number(it.currentStock); };

  const problem = () => {
    if (!usedOuts.length || usedOuts.some((r) => !r.ingredientId)) return "Choose the finished product in the Destination panel.";
    if (!usedIns.length || usedIns.some((r) => !r.ingredientId)) return "Choose every ingredient in the Source panel.";
    if ([...usedIns, ...usedOuts].some((r) => !(Number(r.quantity) > 0))) return "Every row needs a quantity above zero.";
    if (usedIns.some((r) => r.rate !== "" && !(Number(r.rate) >= 0))) return "A rate must be zero or more.";
    if (costs.some((c) => c.amount !== "" && !(Number(c.amount) >= 0))) return "An additional cost must be zero or more.";
    if (new Set([...usedIns, ...usedOuts].map((r) => r.ingredientId)).size !== usedIns.length + usedOuts.length) return "An item can appear only once, and an ingredient cannot also be produced.";
    return null;
  };
  const lines = () => ({
    inputs: usedIns.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit, ...(r.rate.trim() !== "" ? { rate: r.rate.trim() } : {}) })),
    outputs: usedOuts.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit })),
  });
  const costing = { enabled: true as const, costs: costs.filter((c) => c.category.trim() && c.amount !== "").map((c) => ({ category: c.category.trim(), amount: c.amount.trim(), included: true })) };
  const details = () => ({ producedAt: new Date(when), shift: shift || undefined, location: location || undefined, batchRef: batchRef || undefined, notes: notes || undefined, manufacturedOn: madeOn ? new Date(madeOn) : undefined, expiryDate: expiry ? new Date(expiry) : undefined });
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not complete that. Nothing was changed.");

  const fillRecipe = () => {
    const o = usedOuts[0];
    if (!o?.ingredientId) return setError("Choose the finished product first.");
    prefill.mutate({ ingredientId: o.ingredientId, quantity: o.quantity || "1" }, {
      onSuccess: (r) => {
        if (!r.lines.length) return toast.error("This product has no saved recipe. Add the ingredients by hand.");
        setIns(r.lines.map((l) => blankIn({ ingredientId: l.ingredientId, quantity: l.quantity, expected: l.quantity, unit: (byId.get(l.ingredientId)?.unit ?? "") as IngredientUnit })));
        setError(null);
        toast.success(`Filled from the ${r.source}. Expected quantities are shown; type what was actually used.`);
      },
    });
  };

  const goReview = () => {
    const p = problem();
    if (p) return setError(p);
    setError(null);
    if (costed) {
      mfgPreview.mutate({ ...lines(), costing } as Pick<BatchBody, "inputs" | "outputs" | "costing">, {
        onSuccess: (m) => setReview({ lines: [...m.lines.map((l) => ({ ...l, role: "INPUT" as const })), { role: "OUTPUT" as const, ingredientId: usedOuts[0].ingredientId, name: m.finished.name, quantity: m.finished.quantity, unit: m.finished.unit as IngredientUnit, rate: m.unitCost, lineCost: m.totalCost }], canPost: m.canPost && m.shortages.length === 0, shortages: m.shortages, mfg: m }),
        onError: fail,
      });
    } else {
      plainPreview.mutate(lines(), { onSuccess: (r) => setReview({ lines: r.lines as RLine[], canPost: r.canPost, shortages: [], mfg: null }), onError: fail });
    }
  };

  const finish = (id: string, no: string) => {
    const done = () => { toast.success(`Voucher ${no} posted`); onOpenChange(false); };
    if (qResult && settings?.canQuality) quality.mutate({ id, result: qResult, grade: qGrade || undefined, notes: qNotes || undefined }, { onSuccess: done, onError: () => { toast.error(`Voucher ${no} posted, but the quality result was not saved. Record it from the reports page.`); onOpenChange(false); } });
    else done();
  };
  const submit = () => {
    setError(null);
    if (!key.current) key.current = `sjv-${crypto.randomUUID()}`;
    if (costed) mfgPost.mutate({ ...details(), ...lines(), costing, idempotencyKey: key.current } as BatchBody & { idempotencyKey: string }, { onSuccess: (r) => finish(r.id, r.entryNo), onError: fail });
    else plainSave.mutate({ ...details(), ...lines(), idempotencyKey: key.current, post: true } as never, { onSuccess: (r) => finish(r.id, r.entryNo), onError: fail });
  };

  const item = (r: In | Out) => byId.get(r.ingredientId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[94vh] sm:w-[96vw] sm:max-w-[96vw] sm:rounded-xl xl:max-w-7xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Stock journal voucher <span className="ml-2 text-sm font-normal text-muted-foreground">Manufacturing entry · number assigned on posting</span></DialogTitle>
          <DialogDescription>Materials consumed on the left, products made on the right. Nothing changes in stock until you post.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!review ? (
            <div className="flex flex-col gap-4">
              <section aria-label="Voucher details" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1"><Label htmlFor="v-when">Date and time</Label><Input id="v-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-batch">Batch / run no.</Label><Input id="v-batch" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} placeholder="Optional" /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-loc">Location / godown</Label><Input id="v-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main kitchen" /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-shift">Shift</Label><select id="v-shift" className={selectClass} value={shift} onChange={(e) => setShift(e.target.value)}><option value="">None</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-made">Made on</Label><Input id="v-made" type="date" value={madeOn} onChange={(e) => setMadeOn(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-exp">Use by</Label><Input id="v-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section aria-label="Source / Consumption" className="rounded-xl border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
                    <h3 className="text-sm font-semibold">Source / Consumption</h3>
                    <Button type="button" variant="outline" size="sm" disabled={prefill.isPending} onClick={fillRecipe}>Fill from recipe</Button>
                  </div>
                  <div className="overflow-x-auto p-2">
                    <table className="w-full min-w-[34rem] text-sm">
                      <thead><tr><th className={head}>Name of item</th><th className={`${head} text-right`}>Available</th><th className={head}>Quantity</th><th className={head}>Unit</th><th className={head}>Rate</th><th className={`${head} text-right`}>Amount</th><th className="w-8" /></tr></thead>
                      <tbody>
                        {ins.map((r) => {
                          const it = item(r);
                          const amt = Number(r.quantity) > 0 && r.rate !== "" ? Number(r.quantity) * Number(r.rate) : null;
                          const diff = r.expected && r.unit === it?.unit && Number(r.quantity) > 0 ? Number(r.quantity) - Number(r.expected) : null;
                          return (
                            <tr key={r.key} className="align-top">
                              <td className="p-1"><select aria-label="Ingredient" className={selectClass} value={r.ingredientId} onChange={(e) => pickIn(r.key, e.target.value)}><option value="">Choose…</option>{raw.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                                {r.expected && <p className="mt-0.5 text-xs text-muted-foreground">Expected {r.expected}{diff != null && diff !== 0 ? `, ${diff > 0 ? "+" : ""}${Math.round(diff * 1000) / 1000} actual` : ""}</p>}</td>
                              <td className={`p-1 pt-2.5 text-right text-xs tabular-nums ${short(r) ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{it ? `${it.currentStock} ${it.unit}` : "–"}{short(r) ? " · short" : ""}</td>
                              <td className="p-1"><Input aria-label="Quantity consumed" inputMode="decimal" className="w-20" value={r.quantity} onChange={(e) => patchIn(r.key, { quantity: e.target.value })} /></td>
                              <td className="p-1"><select aria-label="Unit" className={selectClass} value={r.unit} onChange={(e) => patchIn(r.key, { unit: e.target.value as IngredientUnit })}>{(it?.units ?? []).map((u) => <option key={u}>{u}</option>)}</select></td>
                              <td className="p-1"><Input aria-label="Rate per unit" inputMode="decimal" className="w-20" placeholder="auto" value={r.rate} onChange={(e) => patchIn(r.key, { rate: e.target.value })} /></td>
                              <td className="p-1 pt-2.5 text-right tabular-nums">{money(amt)}</td>
                              <td className="p-1"><Button type="button" variant="ghost" size="icon-sm" aria-label="Remove ingredient row" disabled={ins.length === 1} onClick={() => setIns((x) => x.filter((y) => y.key !== r.key))}>×</Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between px-1 pt-1"><Button type="button" variant="ghost" size="sm" onClick={() => setIns([...ins, blankIn()])}>+ Add ingredient</Button><span className="text-xs text-muted-foreground">Typed rates total <b className="tabular-nums text-foreground">{money(estimate)}</b></span></div>
                  </div>
                </section>

                <section aria-label="Destination / Production" className="rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2"><h3 className="text-sm font-semibold">Destination / Production</h3></div>
                  <div className="overflow-x-auto p-2">
                    <table className="w-full min-w-[22rem] text-sm">
                      <thead><tr><th className={head}>Name of item</th><th className={head}>Quantity made</th><th className={head}>Unit</th><th className="w-8" /></tr></thead>
                      <tbody>
                        {outs.map((r) => {
                          const it = item(r);
                          return (
                            <tr key={r.key}>
                              <td className="p-1"><select aria-label="Finished product" className={selectClass} value={r.ingredientId} onChange={(e) => pickOut(r.key, e.target.value)}><option value="">Choose…</option>{products.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></td>
                              <td className="p-1"><Input aria-label="Quantity produced" inputMode="decimal" className="w-24" value={r.quantity} onChange={(e) => patchOut(r.key, { quantity: e.target.value })} /></td>
                              <td className="p-1"><select aria-label="Unit" className={selectClass} value={r.unit} onChange={(e) => patchOut(r.key, { unit: e.target.value as IngredientUnit })}>{(it?.units ?? []).map((u) => <option key={u}>{u}</option>)}</select></td>
                              <td className="p-1"><Button type="button" variant="ghost" size="icon-sm" aria-label="Remove product row" disabled={outs.length === 1} onClick={() => setOuts((x) => x.filter((y) => y.key !== r.key))}>×</Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="px-1 pt-1"><Button type="button" variant="ghost" size="sm" onClick={() => setOuts([...outs, blankOut()])}>+ Another finished product</Button></div>
                    {products.length === 0 && <p className="px-1 text-xs text-muted-foreground">No finished products yet. Add one under Stock items with type &ldquo;Finished product&rdquo;.</p>}
                    {settings?.enabled && outs.length > 1 && <p className="px-1 pt-1 text-xs text-muted-foreground">Cost per unit is worked out only when one product is made. With several products the voucher records quantities and consumption without a unit cost.</p>}
                    {!settings?.enabled && <p className="px-1 pt-1 text-xs text-muted-foreground">Costing is switched off, so this voucher records quantities only.</p>}
                  </div>
                  {settings?.enabled && outs.length === 1 && (
                    <div className="border-t border-border p-3">
                      <h4 className="mb-1 text-xs font-medium text-muted-foreground">Additional production costs (optional)</h4>
                      {costs.map((c) => (
                        <div key={c.key} className="mb-1 grid grid-cols-[1fr_6rem_2rem] gap-2">
                          <select aria-label="Cost category" className={selectClass} value={c.category} onChange={(e) => setCosts((x) => x.map((y) => (y.key === c.key ? { ...y, category: e.target.value } : y)))}>{COST_CATEGORIES.map((n) => <option key={n}>{n}</option>)}</select>
                          <Input aria-label="Cost amount" inputMode="decimal" value={c.amount} onChange={(e) => setCosts((x) => x.map((y) => (y.key === c.key ? { ...y, amount: e.target.value } : y)))} />
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove cost" onClick={() => setCosts((x) => x.filter((y) => y.key !== c.key))}>×</Button>
                        </div>
                      ))}
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCosts([...costs, { key: k++, category: COST_CATEGORIES[0], amount: "" }])}>+ Add cost</Button>
                      {extra > 0 && <span className="ml-2 text-xs text-muted-foreground">Total {money(extra)}</span>}
                    </div>
                  )}
                  {settings?.canQuality && (
                    <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
                      <div className="flex flex-col gap-1"><Label htmlFor="q-res">Quality result</Label><select id="q-res" className={selectClass} value={qResult} onChange={(e) => setQResult(e.target.value as QualityResult | "")}><option value="">Not recorded</option><option value="PASS">Passed</option><option value="NEEDS_REVIEW">Needs review</option><option value="FAIL">Failed</option></select></div>
                      <div className="flex flex-col gap-1"><Label htmlFor="q-grade">Grade</Label><Input id="q-grade" value={qGrade} onChange={(e) => setQGrade(e.target.value)} placeholder="e.g. A" disabled={!qResult} /></div>
                      <div className="col-span-2 flex flex-col gap-1"><Label htmlFor="q-notes">Quality notes {qResult === "FAIL" && "(required)"}</Label><Input id="q-notes" value={qNotes} onChange={(e) => setQNotes(e.target.value)} disabled={!qResult} /></div>
                    </div>
                  )}
                </section>
              </div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="v-narr">Narration</Label><Input id="v-narr" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note for this voucher" /></div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium">Check the voucher. Stock changes only when you press Post.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <ReviewPanel title="Source / Consumption" sign="-" lines={review.lines.filter((l) => l.role === "INPUT")} />
                <ReviewPanel title="Destination / Production" sign="+" lines={review.lines.filter((l) => l.role === "OUTPUT")} />
              </div>
              {review.mfg && (
                <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Material cost</dt><dd className="tabular-nums">{money(review.mfg.ingredientCost)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Additional costs</dt><dd className="tabular-nums">{money(review.mfg.additionalCost)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Total production cost</dt><dd className="font-semibold tabular-nums">{money(review.mfg.totalCost)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Cost per {review.mfg.finished.unit.toLowerCase()}</dt><dd className="font-semibold tabular-nums">{money(review.mfg.unitCost)}</dd></div>
                </dl>
              )}
              {review.mfg && review.mfg.missingRates.length > 0 && <p role="alert" className="text-sm text-destructive">No rate known for: {review.mfg.missingRates.join(", ")}. Go back and type a rate, or the cost will be incomplete.</p>}
              {(review.shortages.length > 0 || !review.canPost) && <p role="alert" className="text-sm text-destructive">Not enough stock{review.shortages.length ? `: ${review.shortages.join("; ")}` : " for at least one ingredient"}. Stock is never allowed to go below zero, so fix the count or the quantity first.</p>}
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-background px-4 py-3">
          {!review ? (
            <><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" onClick={goReview} disabled={busy}>{busy ? "Checking…" : "Review voucher"}</Button></>
          ) : (
            <><Button type="button" variant="outline" onClick={() => { setReview(null); setError(null); }}>Back</Button><Button type="button" onClick={submit} disabled={busy || !review.canPost}>{busy ? "Posting…" : "Post voucher"}</Button></>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewPanel({ title, sign, lines }: { title: string; sign: "+" | "-"; lines: RLine[] }) {
  return (
    <section className="rounded-xl border border-border">
      <h3 className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead><tr><th className={head}>Item</th><th className={`${head} text-right`}>Quantity</th><th className={`${head} text-right`}>Rate</th><th className={`${head} text-right`}>Amount</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.ingredientId} className="border-t border-border">
              <td className="px-2 py-1.5">{l.name}</td>
              <td className="px-2 text-right tabular-nums">{sign}{l.quantity} {l.unit}</td>
              <td className="px-2 text-right tabular-nums">{money(l.rate)}</td>
              <td className="px-2 text-right tabular-nums">{money(l.lineCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
