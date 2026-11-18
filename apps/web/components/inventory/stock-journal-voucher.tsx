"use client";

import type { IngredientUnit } from "@nodedr-restaurant/types";
import { useMemo, useRef, useState } from "react";
import { VoucherAddItemDialog } from "@/components/inventory/voucher-add-item-dialog";
import { ItemCombobox, MENU_PREFIX } from "@/components/inventory/item-combobox";
import { MakeProducibleDialog } from "@/components/inventory/make-producible-dialog";
import { SearchSelect } from "@/components/ui/search-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type QualityResult, type VoucherPreview, useMfgSettings, useRecipeFill, useRecipes, useRecipeMutations, useRecordQuality, useVoucherPreview } from "@/hooks/use-manufacturing";
import { type ProductionEntryFull, type StockItem, usePlaces, useProducibleMenuItems, useSaveProduction, useStockItems, useUpdateProductionDraft } from "@/hooks/use-stock-journal";
import Link from "next/link";
import { recipeState, unitProblem } from "@/lib/voucher-rules";
import { useProductionAction } from "@/hooks/use-stock-journal";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

interface In { key: number; ingredientId: string; quantity: string; unit: IngredientUnit | ""; rate: string; expected?: string; locationId: string; lot: string; directTo: string }
interface Out { key: number; ingredientId: string; quantity: string; rejected: string; unit: IngredientUnit | ""; locationId: string; lot: string; percent: string; expected?: string }
interface Cost { key: number; category: string; amount: string }
let k = 1;
const blankIn = (o: Partial<In> = {}): In => ({ key: k++, ingredientId: "", quantity: "", unit: "", rate: "", locationId: "", lot: "", directTo: "", ...o });
const blankOut = (o: Partial<Out> = {}): Out => ({ key: k++, ingredientId: "", quantity: "", rejected: "", unit: "", locationId: "", lot: "", percent: "", ...o });
const SHIFTS = ["Morning", "Afternoon", "Evening", "Night"];
const RECOVERY = "Recovered scrap / by-product";
const COST_CATEGORIES = ["Labour", "Packaging", "Fuel & utilities", "Other overhead", RECOVERY];
const money = (v: number | string | null | undefined) => (v == null || v === "" || Number.isNaN(Number(v)) ? "–" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const q3 = (v: number) => String(Math.round(v * 1000) / 1000);
const local = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toLocal = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
/** Rows of a saved draft, as the form holds them. Outputs use the stock unit so good and rejected stay in one unit. */
const draftIns = (d: ProductionEntryFull): In[] => {
  const rows = d.lines.filter((l) => l.role === "INPUT").map((l) => blankIn({ ingredientId: l.ingredientId, quantity: String(l.enteredQuantity), unit: l.enteredUnit, locationId: l.locationId ?? "", lot: l.lotNumber ?? "", directTo: l.directToIngredientId ?? "", expected: l.expectedQuantity ? String(l.expectedQuantity) : undefined }));
  return rows.length ? rows : [blankIn()];
};
const draftOuts = (d: ProductionEntryFull): Out[] => {
  const rows = d.lines.filter((l) => l.role === "OUTPUT").map((l) => blankOut({ ingredientId: l.ingredientId, quantity: String(l.quantity), unit: l.ingredient.unit, rejected: Number(l.rejectedQuantity) > 0 ? String(l.rejectedQuantity) : "", locationId: l.locationId ?? "", lot: l.lotNumber ?? "", percent: l.allocationPercent ? String(l.allocationPercent) : "", expected: l.expectedQuantity ? String(l.expectedQuantity) : undefined }));
  return rows.length ? rows : [blankOut()];
};
const head = "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground";

export interface VoucherContext { productId?: string; batchRef?: string; narration?: string; sourceIds?: string[]; poId?: string; poNumber?: string; supplier?: string }

/**
 * Stock journal voucher (manufacturing entry), laid out like a Tally stock journal: Source / Consumption on the left,
 * Destination / Production on the right, side by side from lg and stacked (source first) below it. Every number in the
 * review step is worked out by the server and frozen when posted; the menu selling price is never touched here.
 */
export function StockJournalVoucher({ branchId, open, onOpenChange, productId: productIdProp, context, inline, onSaved, draft }: { branchId: string | null; /** A saved draft to reopen and keep editing. Saving changes the same entry; it never creates a second one. */ draft?: ProductionEntryFull; open: boolean; onOpenChange: (o: boolean) => void; productId?: string; context?: VoucherContext; inline?: boolean; /** Told what was saved, so the page can confirm it (success toasts are off app-wide). */ onSaved?: (r: { id: string; entryNo: string; posted: boolean }) => void }) {
  const productId = productIdProp ?? context?.productId;
  const { data: items } = useStockItems(branchId);
  const { data: places } = usePlaces(branchId);
  const { data: settings } = useMfgSettings(branchId);
  const fill = useRecipeFill(branchId);
  const preview = useVoucherPreview(branchId);
  const save = useSaveProduction(branchId);
  const updateDraft = useUpdateProductionDraft(branchId);
  const postAction = useProductionAction(branchId);
  const recipeMut = useRecipeMutations(branchId);
  const [savingRecipe, setSavingRecipe] = useState<{ name: string; error: string | null } | null>(null);
  const quality = useRecordQuality(branchId);
  const [when, setWhen] = useState(() => (draft ? toLocal(draft.producedAt) : local()));
  const [batchRef, setBatchRef] = useState(draft?.batchRef ?? context?.batchRef ?? "");
  const [place, setPlace] = useState(draft?.location ?? ""); // voucher-level place name (printed on the voucher)
  const [shift, setShift] = useState(draft?.shift ?? "");
  const [madeOn, setMadeOn] = useState(draft?.manufacturedOn?.slice(0, 10) ?? "");
  const [expiry, setExpiry] = useState(draft?.expiryDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(draft?.notes ?? context?.narration ?? "");
  const [insRaw, setIns] = useState<In[]>(() => draft ? draftIns(draft) : (context?.sourceIds?.length ? context.sourceIds.map((id) => blankIn({ ingredientId: id })) : [blankIn()]));
  const [outsRaw, setOuts] = useState<Out[]>(() => (draft ? draftOuts(draft) : [blankOut(productId ? { ingredientId: productId } : {})]));
  const [costs, setCosts] = useState<Cost[]>(() => (draft?.costs ?? []).map((c) => ({ key: k++, category: c.category, amount: String(c.amount) })));
  const [method, setMethod] = useState<"QUANTITY" | "MANUAL">(draft?.allocationMethod === "MANUAL" ? "MANUAL" : "QUANTITY");
  const [recipeKey, setRecipeKey] = useState(draft?.recipeKind && draft.recipeId ? `${draft.recipeKind}:${draft.recipeId}` : ""); // "RECIPE:id" | "MENU:id" | ""
  const [qResult, setQResult] = useState<QualityResult | "">("");
  const [qGrade, setQGrade] = useState("");
  const [qNotes, setQNotes] = useState("");
  const [review, setReview] = useState<VoucherPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which "Add item" dialog is open, and which voucher row should receive the new item.
  const [adding, setAdding] = useState<{ kind: "PURCHASED" | "PREPARED"; rowKey: number | null; existingId?: string } | null>(null);
  const key = useRef("");
  // The row the user last worked in, so a newly added item lands there (when it is still empty) and not somewhere else.
  const activeIn = useRef<number | null>(null);
  const activeOut = useRef<number | null>(null);
  // The control that opened the Add Item dialog, so keyboard focus goes back to it when the dialog closes.
  const opener = useRef<HTMLElement | null>(null);
  const openAdding = (next: { kind: "PURCHASED" | "PREPARED"; rowKey: number | null; existingId?: string }) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAdding(next);
  };
  const closeAdding = () => {
    setAdding(null);
    const el = opener.current;
    if (el) setTimeout(() => el.isConnected && el.focus(), 0);
  };

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const raw = (items ?? []).filter((i) => i.kind === "PURCHASED");
  const products = (items ?? []).filter((i) => i.kind === "PREPARED");
  // Menu items with no stock item yet are offered too: picking one links it (after a confirmation) and uses it.
  const { data: me } = useCurrentUser();
  const canLink = hasPermission(me?.user, "journal.manage");
  const canAddItems = hasPermission(me?.user, "inventory.manage");
  const canPutOnMenu = canAddItems && hasPermission(me?.user, "menu.manage");
  const canPost = hasPermission(me?.user, "production.post");
  const { data: menuOnlyAll } = useProducibleMenuItems(canLink ? branchId : null);
  const menuOnly = canLink ? menuOnlyAll : undefined;
  const productChoices = useMemo<StockItem[]>(
    () => [...products, ...(menuOnly ?? []).map((m) => ({ id: `${MENU_PREFIX}${m.id}`, name: m.name, unit: "PIECE" as const, kind: "PREPARED" as const, category: m.category, currentStock: "0", units: [] }))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, menuOnly],
  );
  const [linking, setLinking] = useState<{ rowKey: number; menuId: string } | null>(null);
  const activePlaces = (places ?? []).filter((p) => p.isActive);
  // Rows started from a purchase order have an item but no unit yet; use the item's own unit until one is chosen.
  const ins = useMemo(() => insRaw.map((x) => (x.ingredientId && !x.unit ? { ...x, unit: (byId.get(x.ingredientId)?.unit ?? "") as IngredientUnit | "" } : x)), [insRaw, byId]);
  const outs = useMemo(() => outsRaw.map((x) => (x.ingredientId && !x.unit ? { ...x, unit: (byId.get(x.ingredientId)?.unit ?? "") as IngredientUnit | "" } : x)), [outsRaw, byId]);
  const costed = !!settings?.enabled;
  const busy = preview.isPending || save.isPending || fill.isPending || updateDraft.isPending || postAction.isPending;
  const firstProduct = outs[0]?.ingredientId ?? "";
  // Recipes belong to one product: nothing is requested until the product is chosen, and the empty message is only
  // shown for a request that succeeded and returned no recipes for that product.
  const recipesQ = useRecipes(branchId, firstProduct || undefined, false, !!firstProduct);
  const recipes = recipesQ.isSuccess && !recipesQ.isError ? recipesQ.data : undefined;
  const rState = recipeState({ hasProduct: !!firstProduct, isError: recipesQ.isError, isSuccess: recipesQ.isSuccess, count: recipes?.length ?? 0 });
  const recipe = (recipes ?? []).find((r) => `${r.kind}:${r.id}` === recipeKey);
  const multi = outs.filter((o) => o.ingredientId).length > 1;

  const patchIn = (id: number, p: Partial<In>) => setIns((r) => r.map((x) => (x.key === id ? { ...x, ...p } : x)));
  const patchOut = (id: number, p: Partial<Out>) => setOuts((r) => r.map((x) => (x.key === id ? { ...x, ...p } : x)));
  const pickIn = (id: number, ing: string) => patchIn(id, { ingredientId: ing, unit: byId.get(ing)?.unit ?? "", expected: undefined });
  const pickOut = (id: number, ing: string) => {
    if (ing.startsWith(MENU_PREFIX)) return setLinking({ rowKey: id, menuId: ing.slice(MENU_PREFIX.length) });
    patchOut(id, { ingredientId: ing, unit: byId.get(ing)?.unit ?? "" });
    setRecipeKey("");
  };
  const pickRecipe = (v: string) => setRecipeKey(v);
  const startSaveRecipe = () => {
    const o = usedOuts[0];
    if (usedOuts.length !== 1 || !o?.ingredientId) return setError("To save a recipe, choose exactly one finished product in Destination.");
    if (!(Number(o.quantity) > 0)) return setError("Type the good quantity first: the recipe is saved for that quantity.");
    if (!usedIns.length || usedIns.some((r) => !r.ingredientId || !(Number(r.quantity) > 0))) return setError("Choose every ingredient and give each a quantity above zero before saving a recipe.");
    setError(null);
    setSavingRecipe({ name: `${byId.get(o.ingredientId)?.name ?? "Recipe"}`, error: null });
  };
  const confirmSaveRecipe = () => {
    const o = usedOuts[0];
    if (!savingRecipe || !o) return;
    if (!savingRecipe.name.trim()) return setSavingRecipe({ ...savingRecipe, error: "Give the recipe a name." });
    recipeMut.create.mutate(
      { outputIngredientId: o.ingredientId, name: savingRecipe.name.trim(), baseOutputQty: o.quantity.trim(), lines: usedIns.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit })) },
      {
        onSuccess: (rec) => { setRecipeKey(`${rec.kind ?? "RECIPE"}:${rec.id}`); setSavingRecipe(null); toast.success("Recipe saved. Stock was not changed."); },
        onError: (e) => setSavingRecipe({ ...savingRecipe, error: e instanceof ApiError ? e.message : "Could not save the recipe. Nothing was changed." }),
      },
    );
  };
  const enterAdds = (isLast: boolean, add: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" && isLast) { e.preventDefault(); add(); } };

  const usedIns = ins.filter((r) => r.ingredientId || r.quantity);
  const usedOuts = outs.filter((r) => r.ingredientId || r.quantity);
  const estimate = usedIns.reduce((s, r) => s + (Number(r.quantity) > 0 && r.rate !== "" ? Number(r.quantity) * Number(r.rate) : 0), 0);
  const short = (r: In) => { const it = byId.get(r.ingredientId); return !!it && r.unit === it.unit && Number(r.quantity) > Number(it.currentStock); };

  // Ingredient use against the recipe, same-unit rows only; shown beside the table and again per row.
  const yieldInfo = useMemo(() => {
    const rows = ins.filter((r) => r.expected && Number(r.expected) > 0 && Number(r.quantity) > 0 && r.unit === (byId.get(r.ingredientId)?.unit ?? r.unit));
    if (!rows.length) return null;
    const expected = rows.reduce((a, r) => a + Number(r.expected), 0);
    const used = rows.reduce((a, r) => a + Number(r.quantity), 0);
    return { expected: q3(expected), used: q3(used), pct: ((used - expected) / expected) * 100 };
  }, [ins, byId]);

  const problem = () => {
    if (!usedOuts.length || usedOuts.some((r) => !r.ingredientId)) return "Choose the finished product in the Destination panel.";
    if (!usedIns.length || usedIns.some((r) => !r.ingredientId)) return "Choose every ingredient in the Source panel.";
    if ([...usedIns, ...usedOuts].some((r) => !(Number(r.quantity) > 0))) return "Every row needs a quantity above zero (for a product, the good quantity).";
    for (const r of [...usedIns, ...usedOuts]) { const u = unitProblem(byId.get(r.ingredientId), r.unit); if (u) return u; }
    if (usedOuts.some((r) => r.rejected !== "" && !(Number(r.rejected) >= 0))) return "Rejected quantity must be zero or more.";
    if (costed && usedIns.some((r) => r.rate !== "" && !(Number(r.rate) >= 0))) return "A rate must be zero or more.";
    if (costs.some((c) => c.amount !== "" && !(Number(c.amount) >= 0))) return "An additional cost must be zero or more.";
    if (new Set([...usedIns, ...usedOuts].map((r) => r.ingredientId)).size !== usedIns.length + usedOuts.length) return "An item can appear only once, and an ingredient cannot also be produced.";
    if (multi && method === "MANUAL") {
      const sum = usedOuts.reduce((a, r) => a + Number(r.percent || 0), 0);
      if (Math.abs(sum - 100) > 0.001) return `The percents add up to ${q3(sum)}; they must add up to 100.`;
    }
    return null;
  };
  const lines = () => ({
    inputs: usedIns.map((r) => ({
      ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit,
      ...(costed && r.rate.trim() !== "" ? { rate: r.rate.trim() } : {}),
      ...(r.expected ? { expectedQuantity: r.expected } : {}),
      ...(r.locationId ? { locationId: r.locationId } : {}),
      ...(r.lot.trim() ? { lotNumber: r.lot.trim() } : {}),
      ...(multi && r.directTo ? { directToIngredientId: r.directTo } : {}),
    })),
    outputs: usedOuts.map((r) => ({
      ingredientId: r.ingredientId, quantity: r.quantity.trim(), unit: r.unit as IngredientUnit,
      ...(r.rejected.trim() !== "" && Number(r.rejected) > 0 ? { rejectedQuantity: r.rejected.trim() } : {}),
      ...(r.expected ? { expectedQuantity: r.expected } : {}),
      ...(r.locationId ? { locationId: r.locationId } : {}),
      ...(r.lot.trim() ? { lotNumber: r.lot.trim() } : {}),
      ...(multi && method === "MANUAL" ? { allocationPercent: r.percent } : {}),
    })),
  });
  const costing = { enabled: true as const, costs: costs.filter((c) => c.category.trim() && c.amount !== "").map((c) => ({ category: c.category.trim(), amount: c.amount.trim(), included: true })) };
  const extras = () => ({
    ...(multi ? { allocationMethod: method } : {}),
    ...(recipe ? { recipe: { kind: recipe.kind, id: recipe.id } } : {}),
    ...(context?.poId ? { sourcePoId: context.poId } : {}),
  });
  const details = () => ({ producedAt: new Date(when), shift: shift || undefined, location: place || undefined, batchRef: batchRef || undefined, notes: notes || undefined, manufacturedOn: madeOn ? new Date(madeOn) : undefined, expiryDate: expiry ? new Date(expiry) : undefined });
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not complete that. Nothing was changed.");

  const fillRecipe = () => {
    const o = usedOuts[0];
    if (!o?.ingredientId) return setError("Choose the finished product first.");
    if (!recipe) return setError(!recipesQ.isSuccess ? "The recipes for this product have not loaded yet. Try again in a moment." : recipes?.length ? "Choose which recipe to fill from." : "No saved recipes for this product yet. Enter the ingredients by hand and press \"Save as recipe\", or add one under Inventory > Recipes.");
    if (!(Number(o.quantity) > 0)) return setError("Type the planned good quantity first; the recipe is scaled to it.");
    fill.mutate({ kind: recipe.kind, id: recipe.id, quantity: o.quantity }, {
      onSuccess: (r) => {
        setIns(r.lines.map((l) => blankIn({ ingredientId: l.ingredientId, quantity: l.quantity, expected: l.quantity, unit: l.unit })));
        patchOut(o.key, { expected: o.quantity });
        setError(null);
        toast.success(`Filled from ${r.recipe.name} v${r.recipe.version} for ${r.plannedOutput}. Type what was really used.`);
      },
      onError: fail,
    });
  };

  const goReview = () => {
    const p = problem();
    if (p) return setError(p);
    setError(null);
    preview.mutate({ ...lines(), ...(costed ? { costing } : {}), ...(multi ? { allocationMethod: method } : {}) }, { onSuccess: setReview, onError: fail });
  };

  const finish = (id: string, no: string) => {
    const done = () => { onSaved?.({ id, entryNo: no, posted: true }); onOpenChange(false); };
    if (qResult && settings?.canQuality) quality.mutate({ id, result: qResult, grade: qGrade || undefined, notes: qNotes || undefined }, { onSuccess: done, onError: () => { toast.error(`Voucher ${no} posted, but the quality result was not saved. Record it from the reports page.`); done(); } });
    else done();
  };
  const submit = () => {
    setError(null);
    if (draft) {
      // Save the edits to the same draft, then post it. A second click cannot post twice: the server only posts a draft once.
      updateDraft.mutate({ id: draft.id, body: { ...details(), ...lines(), ...extras(), ...(costed ? { costing } : {}) } as never }, {
        onSuccess: () => postAction.mutate({ id: draft.id, action: "post" }, { onSuccess: () => finish(draft.id, draft.entryNo), onError: (e) => setError(`Your changes were saved to draft ${draft.entryNo}, but it was not posted: ${e instanceof ApiError ? e.message : "try again"}. Stock has not changed.`) }),
        onError: fail,
      });
      return;
    }
    if (!key.current) key.current = `sjv-${crypto.randomUUID()}`;
    save.mutate({ ...details(), ...lines(), ...extras(), ...(costed ? { costing } : {}), idempotencyKey: key.current, post: true } as never, { onSuccess: (r) => finish(r.id, r.entryNo), onError: fail });
  };
  // A draft changes no stock; it shows in the journal list, where it can be posted or deleted later.
  const draftKey = useRef("");
  const saveDraft = () => {
    const p = problem();
    if (p) return setError(p);
    setError(null);
    if (draft) {
      updateDraft.mutate({ id: draft.id, body: { ...details(), ...lines(), ...extras(), ...(costed ? { costing } : {}) } as never }, {
        onSuccess: () => { onSaved?.({ id: draft.id, entryNo: draft.entryNo, posted: false }); onOpenChange(false); },
        onError: fail,
      });
      return;
    }
    if (!draftKey.current) draftKey.current = `sjd-${crypto.randomUUID()}`;
    save.mutate({ ...details(), ...lines(), ...extras(), ...(costed ? { costing } : {}), idempotencyKey: draftKey.current, post: false } as never, {
      onSuccess: (r) => { onSaved?.({ id: r.id, entryNo: r.entryNo, posted: false }); onOpenChange(false); },
      onError: fail,
    });
  };

  const item = (r: In | Out) => byId.get(r.ingredientId);
  const placeSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <SearchSelect aria-label={label} value={value} onChange={onChange} placeholder="No place" emptyText="No place matches"
      options={[{ value: "", label: "No place" }, ...activePlaces.map((p) => ({ value: p.id, label: p.name }))]} />
  );

  const cancelText = inline ? "Clear" : "Cancel";
  const inner = (
    <>
        {linking && (() => {
          const m = (menuOnly ?? []).find((x) => x.id === linking.menuId);
          return m ? (
            <MakeProducibleDialog branchId={branchId} item={m} onCancel={() => setLinking(null)}
              onDone={(stockId, unit) => { patchOut(linking.rowKey, { ingredientId: stockId, unit }); setRecipeKey(""); setLinking(null); }} />
          ) : null;
        })()}
        {savingRecipe && (
          <Dialog open onOpenChange={(o) => !o && !recipeMut.create.isPending && setSavingRecipe(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Save as recipe</DialogTitle>
                <DialogDescription>Saves the ingredients and quantities in this voucher as a reusable recipe for {byId.get(usedOuts[0]?.ingredientId ?? "")?.name ?? "this product"}, making {usedOuts[0]?.quantity} {(usedOuts[0]?.unit || "").toLowerCase()}. This does not change stock and does not save or post the voucher.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5"><Label htmlFor="sr-name">Recipe name</Label><Input id="sr-name" autoFocus value={savingRecipe.name} onChange={(e) => setSavingRecipe({ ...savingRecipe, name: e.target.value, error: null })} /></div>
              {savingRecipe.error && <p role="alert" className="text-sm text-destructive">{savingRecipe.error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={recipeMut.create.isPending} onClick={() => setSavingRecipe(null)}>Cancel</Button>
                <Button type="button" disabled={recipeMut.create.isPending} onClick={confirmSaveRecipe}>{recipeMut.create.isPending ? "Saving…" : "Save recipe"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {adding && (
          <VoucherAddItemDialog branchId={branchId} kind={adding.kind} open onOpenChange={(o) => !o && closeAdding()}
            existing={adding.existingId ? (() => { const e = byId.get(adding.existingId!); return e ? { id: e.id, name: e.name, unit: e.unit } : undefined; })() : undefined}
            onCreated={(id) => {
              if (adding.existingId) return;
              // Put the new item straight into the first empty row, or a new one, so nothing is retyped.
              if (adding.kind === "PREPARED") {
                const empty = outsRaw.find((r) => r.key === activeOut.current && !r.ingredientId) ?? outsRaw.find((r) => !r.ingredientId);
                if (empty) setOuts((r) => r.map((x) => (x.key === empty.key ? { ...x, ingredientId: id } : x)));
                else setOuts((r) => [...r, blankOut({ ingredientId: id })]);
                setRecipeKey("");
              } else {
                const empty = insRaw.find((r) => r.key === activeIn.current && !r.ingredientId) ?? insRaw.find((r) => !r.ingredientId);
                if (empty) setIns((r) => r.map((x) => (x.key === empty.key ? { ...x, ingredientId: id } : x)));
                else setIns((r) => [...r, blankIn({ ingredientId: id })]);
              }
            }} />
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!review ? (
            <div className="flex flex-col gap-4">
              <section aria-label="Voucher details" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1"><Label htmlFor="v-when">Date and time</Label><Input id="v-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-batch">Batch / reference no.</Label><Input id="v-batch" value={batchRef} onChange={(e) => setBatchRef(e.target.value)} placeholder="Optional, e.g. MOMO-12" /></div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="v-loc">Location / godown</Label>
                  <SearchSelect id="v-loc" value={place} onChange={setPlace} placeholder="Not stated"
                    options={[{ value: "", label: "Not stated" }, ...activePlaces.map((p) => ({ value: p.name, label: p.name }))]} />
                </div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-shift">Shift</Label><SearchSelect id="v-shift" value={shift} onChange={setShift} placeholder="None" options={[{ value: "", label: "None" }, ...SHIFTS.map((s) => ({ value: s, label: s }))]} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-made">Made on</Label><Input id="v-made" type="date" value={madeOn} onChange={(e) => setMadeOn(e.target.value)} /></div>
                <div className="flex flex-col gap-1.5"><Label htmlFor="v-exp">Use by</Label><Input id="v-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
              </section>

              <div className="grid gap-4 2xl:grid-cols-2">
                <section aria-label="Source / Consumption" className="min-w-0 rounded-xl border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                    <h3 className="text-sm font-semibold">Source / Consumption</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <SearchSelect aria-label="Recipe" className="w-56" value={recipeKey} onChange={pickRecipe} placeholder="Search recipes…" emptyText="No recipe matches"
                        options={[{ value: "", label: "No recipe (manual)" }, ...(recipes ?? []).map((r) => ({ value: `${r.kind}:${r.id}`, label: r.name, hint: `base ${r.baseOutputQty} ${r.outputUnit.toLowerCase()} · v${r.version}` }))]} />
                      <Button type="button" variant="outline" size="sm" disabled={fill.isPending || !recipeKey} onClick={fillRecipe}>Fill from recipe</Button>
                      {canAddItems && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={startSaveRecipe} title="Keeps these ingredients as a reusable recipe. Stock is not changed.">Save as recipe</Button>}
                    </div>
                  </div>
                  <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
                    {rState === "choose-product" ? <p role="status">Choose the product to produce first; its saved recipes will appear here.</p>
                      : rState === "error" ? <p role="alert" className="text-destructive">Could not load recipes for this product. <button type="button" className="underline underline-offset-2" onClick={() => void recipesQ.refetch()}>Try again</button></p>
                      : rState === "loading" ? <p role="status">Loading recipes…</p>
                      : rState === "empty" ? <p role="status"><b className="text-foreground">No saved recipes for this product yet</b></p> : null}
                    <p>
                      A recipe is a reusable list of ingredients and quantities for making one product. Choosing one fills the rows below; you can change every number before saving. Saving a recipe never changes stock; only posting this voucher does.
                      {canAddItems && <> <Link href="/inventory/recipes" target="_blank" rel="noopener" className="underline underline-offset-2">Create recipe</Link> in a new tab, or fill the rows and press Save as recipe.</>}
                    </p>
                  </div>
                  <div className="overflow-x-auto p-2">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead><tr><th className={head}>Name of item</th><th className={`${head} text-right`}>Available</th><th className={head}>Quantity</th><th className={head}>Unit</th><th className={`${head} text-right`}>Expected</th>{costed && <><th className={head}>Rate</th><th className={`${head} text-right`}>Amount</th></>}<th className="w-8" /></tr></thead>
                      <tbody>
                        {ins.map((r, idx) => {
                          const it = item(r);
                          const amt = Number(r.quantity) > 0 && r.rate !== "" ? Number(r.quantity) * Number(r.rate) : null;
                          const exp = r.expected && it && r.unit === it.unit ? Number(r.expected) : null;
                          const diff = exp != null && Number(r.quantity) > 0 ? Number(r.quantity) - exp : null;
                          return (
                            <tr key={r.key} onFocusCapture={() => { activeIn.current = r.key; }} className="align-top [&>td]:border-b [&>td]:border-border/60">
                              <td className="p-1">
                                <ItemCombobox label="Ingredient" items={raw} value={r.ingredientId} onChange={(id) => pickIn(r.key, id)} />
                                <div className="mt-1 grid grid-cols-[minmax(7rem,1fr)_5rem] gap-1">
                                  {placeSelect(r.locationId, (v) => patchIn(r.key, { locationId: v }), "Take from place")}
                                  <Input aria-label="Lot or batch no." className="h-9" placeholder="Lot" value={r.lot} onChange={(e) => patchIn(r.key, { lot: e.target.value })} />
                                </div>
                                {multi && (
                                  <SearchSelect aria-label="Cost belongs to" className="mt-1" value={r.directTo} onChange={(v) => patchIn(r.key, { directTo: v })} placeholder="Shared by all products"
                                    options={[{ value: "", label: "Shared by all products" }, ...usedOuts.filter((o) => o.ingredientId).map((o) => ({ value: o.ingredientId, label: `Only ${byId.get(o.ingredientId)?.name ?? ""}` }))]} />
                                )}
                              </td>
                              <td className={`p-1 pt-2.5 text-right text-xs tabular-nums ${short(r) ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{it ? `${it.currentStock} ${it.unit}` : "–"}{short(r) ? " · short" : ""}</td>
                              <td className="p-1"><Input aria-label="Quantity consumed" inputMode="decimal" className="w-20" value={r.quantity} onChange={(e) => patchIn(r.key, { quantity: e.target.value })} onKeyDown={enterAdds(idx === ins.length - 1, () => setIns([...ins, blankIn()]))} /></td>
                              <td className="min-w-[5.5rem] p-1"><SearchSelect aria-label="Unit" value={r.unit} placeholder="Unit" disabled={!it} onChange={(v) => v && patchIn(r.key, { unit: v as IngredientUnit })} options={(it?.units ?? []).map((u) => ({ value: u, label: u }))} /></td>
                              <td className="p-1 pt-2.5 text-right text-xs tabular-nums text-muted-foreground">
                                {r.expected ?? "–"}
                                {diff != null && diff !== 0 && <span className={`block ${Math.abs(diff / exp!) > 0.05 ? "text-destructive" : ""}`}>{diff > 0 ? "+" : ""}{q3(diff)} ({diff > 0 ? "+" : ""}{((diff / exp!) * 100).toFixed(1)}%)</span>}
                              </td>
                              {costed && <><td className="p-1"><Input aria-label="Rate per unit" inputMode="decimal" className="w-20" placeholder="avg" value={r.rate} onChange={(e) => patchIn(r.key, { rate: e.target.value })} /></td>
                              <td className="p-1 pt-2.5 text-right tabular-nums">{money(amt)}</td></>}
                              <td className="p-1"><Button type="button" variant="ghost" size="icon-sm" aria-label="Remove ingredient row" disabled={ins.length === 1} onClick={() => setIns((x) => x.filter((y) => y.key !== r.key))}>×</Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {yieldInfo && <p className="px-1 pt-1 text-xs text-muted-foreground">Against the recipe: <b className={Math.abs(yieldInfo.pct) > 5 ? "text-destructive" : "text-foreground"}>{yieldInfo.pct > 0 ? "+" : ""}{yieldInfo.pct.toFixed(1)}%</b> ingredient use ({yieldInfo.used} of {yieldInfo.expected} expected, same-unit rows). Less is not automatically better; check the quality note.</p>}
                    <div className="flex items-center justify-between px-1 pt-1"><div className="flex flex-wrap gap-1"><Button type="button" variant="outline" size="sm" onClick={() => setIns([...ins, blankIn()])}>+ Add source row</Button>{canAddItems && <Button type="button" variant="ghost" size="sm" onClick={() => openAdding({ kind: "PURCHASED", rowKey: null })}>+ Add inventory item</Button>}</div>{costed && <span className="text-xs text-muted-foreground">Typed rates total <b className="tabular-nums text-foreground">{money(estimate)}</b> (blank rate = average cost)</span>}</div>
                  </div>
                </section>

                <section aria-label="Destination / Production" className="min-w-0 rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2"><h3 className="text-sm font-semibold">Destination / Production</h3></div>
                  <div className="overflow-x-auto p-2">
                    <table className="w-full min-w-[28rem] text-sm">
                      <thead><tr><th className={head}>Name of item</th><th className={head}>Good qty</th><th className={head}>Rejected</th><th className={head}>Unit</th>{multi && method === "MANUAL" && <th className={head}>Cost %</th>}<th className="w-8" /></tr></thead>
                      <tbody>
                        {outs.map((r, idx) => {
                          const it = item(r);
                          return (
                            <tr key={r.key} onFocusCapture={() => { activeOut.current = r.key; }} className="align-top [&>td]:border-b [&>td]:border-border/60">
                              <td className="p-1">
                                <ItemCombobox label="Finished product" placeholder="Search products…" items={productChoices} value={r.ingredientId} onChange={(id) => pickOut(r.key, id)} />
                                {canPutOnMenu && it && it.onMenu === false && (
                                  <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => openAdding({ kind: "PREPARED", rowKey: null, existingId: it.id })}>Not on the POS menu yet: put it on the menu…</Button>
                                )}
                                <div className="mt-1 grid grid-cols-[minmax(7rem,1fr)_5rem] gap-1">
                                  {placeSelect(r.locationId, (v) => patchOut(r.key, { locationId: v }), "Put into place")}
                                  <Input aria-label="Lot or batch no." className="h-9" placeholder="Lot" value={r.lot} onChange={(e) => patchOut(r.key, { lot: e.target.value })} />
                                </div>
                              </td>
                              <td className="p-1"><Input aria-label="Good quantity produced" inputMode="decimal" className="w-20" value={r.quantity} onChange={(e) => patchOut(r.key, { quantity: e.target.value })} onKeyDown={enterAdds(idx === outs.length - 1 && false, () => undefined)} />{r.expected && <p className="mt-0.5 text-xs text-muted-foreground">Plan {r.expected}</p>}</td>
                              <td className="p-1"><Input aria-label="Rejected quantity" inputMode="decimal" className="w-20" placeholder="0" value={r.rejected} onChange={(e) => patchOut(r.key, { rejected: e.target.value })} /></td>
                              <td className="min-w-[5.5rem] p-1"><SearchSelect aria-label="Unit" value={r.unit} placeholder="Unit" disabled={!it} onChange={(v) => v && patchOut(r.key, { unit: v as IngredientUnit })} options={(it?.units ?? []).map((u) => ({ value: u, label: u }))} /></td>
                              {multi && method === "MANUAL" && <td className="p-1"><Input aria-label="Cost percent" inputMode="decimal" className="w-16" value={r.percent} onChange={(e) => patchOut(r.key, { percent: e.target.value })} /></td>}
                              <td className="p-1"><Button type="button" variant="ghost" size="icon-sm" aria-label="Remove product row" disabled={outs.length === 1} onClick={() => setOuts((x) => x.filter((y) => y.key !== r.key))}>×</Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="flex flex-wrap gap-1 px-1 pt-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => setOuts([...outs, blankOut()])}>+ Add co-product</Button>
                      {canPutOnMenu && <Button type="button" variant="ghost" size="sm" onClick={() => openAdding({ kind: "PREPARED", rowKey: null })}>+ Add menu item</Button>}
                    </div>
                    {canPutOnMenu && products.length === 0 && (menuOnly ?? []).length === 0 && (
                      <div className="mx-1 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                        <span>No finished products or menu items yet.</span>
                        <Button type="button" size="sm" onClick={() => openAdding({ kind: "PREPARED", rowKey: outs[0]?.key ?? null })}>Add Item</Button>
                      </div>
                    )}
                    <p className="px-1 pt-1 text-xs text-muted-foreground">Good quantity goes into stock. Rejected pieces are only recorded; their cost stays in the batch and is carried by the good pieces.</p>
                    {multi && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2 text-xs">
                        <span className="font-medium">Split shared cost between products:</span>
                        <label className="flex items-center gap-1"><input type="radio" name="alloc" checked={method === "QUANTITY"} onChange={() => setMethod("QUANTITY")} /> by good quantity (same unit)</label>
                        <label className="flex items-center gap-1"><input type="radio" name="alloc" checked={method === "MANUAL"} onChange={() => setMethod("MANUAL")} /> by manual percent</label>
                        <span className="text-muted-foreground">A material marked &ldquo;Only …&rdquo; goes wholly to that product.</span>
                      </div>
                    )}
                  </div>
                  {costed && (
                    <div className="border-t border-border p-3">
                      <h4 className="mb-1 text-xs font-medium text-muted-foreground">Additional production costs (optional)</h4>
                      {costs.map((c) => (
                        <div key={c.key} className="mb-1 grid grid-cols-[1fr_6rem_2rem] gap-2">
                          <SearchSelect aria-label="Cost category" value={c.category} onChange={(v) => v && setCosts((x) => x.map((y) => (y.key === c.key ? { ...y, category: v } : y)))} options={COST_CATEGORIES.map((n) => ({ value: n, label: n }))} />
                          <Input aria-label="Cost amount" inputMode="decimal" value={c.amount} onChange={(e) => setCosts((x) => x.map((y) => (y.key === c.key ? { ...y, amount: e.target.value } : y)))} />
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove cost" onClick={() => setCosts((x) => x.filter((y) => y.key !== c.key))}>×</Button>
                        </div>
                      ))}
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCosts([...costs, { key: k++, category: COST_CATEGORIES[0], amount: "" }])}>+ Add cost</Button>
                      <p className="text-xs text-muted-foreground">&ldquo;{RECOVERY}&rdquo; is subtracted from the batch cost.</p>
                    </div>
                  )}
                  {!costed && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Costing is switched off, so this voucher records quantities only.</p>}
                  {settings?.canQuality && (
                    <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
                      <div className="flex flex-col gap-1"><Label htmlFor="q-res">Quality result</Label><SearchSelect id="q-res" value={qResult} onChange={(v) => setQResult(v as QualityResult | "")} placeholder="Not recorded" options={[{ value: "", label: "Not recorded" }, { value: "PASS", label: "Passed" }, { value: "NEEDS_REVIEW", label: "Needs review" }, { value: "FAIL", label: "Failed" }]} /></div>
                      <div className="flex flex-col gap-1"><Label htmlFor="q-grade">Grade</Label><Input id="q-grade" value={qGrade} onChange={(e) => setQGrade(e.target.value)} placeholder="e.g. A" disabled={!qResult} /></div>
                      <div className="col-span-2 flex flex-col gap-1"><Label htmlFor="q-notes">Quality notes {qResult === "FAIL" && "(required)"}</Label><Input id="q-notes" value={qNotes} onChange={(e) => setQNotes(e.target.value)} disabled={!qResult} /></div>
                    </div>
                  )}
                </section>
              </div>
              <div className="flex flex-col gap-1.5"><Label htmlFor="v-narr">Narration</Label><Input id="v-narr" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note for this voucher" /></div>
            </div>
          ) : (
            <ReviewBody review={review} recipe={recipe ? `${recipe.name} v${recipe.version}` : null} />
          )}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-4 py-3">
          {!review ? (
            <><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{cancelText}</Button><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={saveDraft} disabled={busy} title="Keeps the voucher for later. Stock is not changed.">{save.isPending ? "Saving…" : "Save draft (no stock change)"}</Button><Button type="button" onClick={goReview} disabled={busy} title="Shows what will change. Nothing is posted yet.">{busy ? "Checking…" : "Review before posting"}</Button></div></>
          ) : (
            <><Button type="button" variant="outline" onClick={() => { setReview(null); setError(null); }}>Back to edit</Button><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={saveDraft} disabled={busy} title="Keeps the voucher for later. Stock is not changed.">Save draft (no stock change)</Button><Button type="button" onClick={submit} disabled={busy || !review.canPost || !canPost} title={canPost ? "Applies the stock movements now. This happens once." : "You can save a draft; someone with permission to post must post it."}>{busy ? "Posting…" : "Post voucher & update stock"}</Button></div></>
          )}
        </div>
    </>
  );

  if (inline) {
    return (
      <div className="tally-voucher flex min-h-[70vh] flex-col overflow-hidden rounded-md border border-[#7aa6cf] bg-[#e9f2fb] text-foreground dark:border-border dark:bg-card">
        <div className="flex items-center justify-between bg-[#8fb8de] px-3 py-1 text-sm font-semibold text-[#0b2a4a] dark:bg-muted dark:text-foreground">
          <span>Inventory Voucher Creation</span>
          <span>{context?.poNumber ? `From ${context.poNumber}` : "Manufacturing"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          <span className="rounded-sm bg-[#2f5fa7] px-3 py-0.5 text-sm font-semibold text-white">Stock Journal</span>
          <span className="text-sm">No. <b>given when saved</b></span>
          <span className="mx-auto text-sm font-semibold underline underline-offset-4">Manufacturing: materials used, products made</span>
          <span className="text-xs text-muted-foreground">Nothing changes in stock until you post</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-background">{inner}</div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[94vh] sm:w-[96vw] sm:max-w-[96vw] sm:rounded-xl xl:max-w-[88rem]">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Stock journal voucher <span className="ml-2 text-sm font-normal text-muted-foreground">Manufacturing · {review ? "ready to post" : "nothing posted yet"} · number given when saved</span></DialogTitle>
          <DialogDescription>
            Materials consumed on the left, products made on the right. Nothing changes in stock until you post.
            {context?.poNumber ? ` Started from ${context.poNumber}${context.supplier ? ` (${context.supplier})` : ""}; the purchase order is only a reference and never receives stock again.` : ""}
          </DialogDescription>
        </DialogHeader>

        {inner}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({ review, recipe }: { review: VoucherPreview; recipe: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">Check the voucher. Stock changes only when you press “Post voucher & update stock”.</p>
      <p className="text-xs text-muted-foreground">{recipe ? `Recipe baseline: ${recipe}.` : "No recipe baseline: quantities were entered by hand."}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border">
          <h3 className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold">Source / Consumption</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className={head}>Item</th><th className={`${head} text-right`}>Used</th><th className={`${head} text-right`}>Expected</th>{review.costed && <><th className={`${head} text-right`}>Rate</th><th className={`${head} text-right`}>Amount</th></>}</tr></thead>
            <tbody>{review.inputs.map((l) => (
              <tr key={l.ingredientId} className="border-t border-border">
                <td className="px-2 py-1.5">{l.name}{l.location ? <span className="block text-xs text-muted-foreground">from {l.location}{l.atLocation ? ` (has ${l.atLocation})` : ""}</span> : null}</td>
                <td className="px-2 text-right tabular-nums">−{l.quantity} {l.unit}</td>
                <td className="px-2 text-right text-xs tabular-nums text-muted-foreground">{l.expected ?? "–"}{l.variance && Number(l.variance) !== 0 ? <span className="block">{Number(l.variance) > 0 ? "+" : ""}{l.variance} ({l.variancePercent}%)</span> : null}</td>
                {review.costed && <><td className="px-2 text-right tabular-nums">{money(l.rate)}<span className="block text-xs text-muted-foreground">{l.rateSource}</span></td>
                <td className="px-2 text-right tabular-nums">{money(l.lineCost)}</td></>}
              </tr>))}</tbody>
          </table></div>
        </section>
        <section className="rounded-xl border border-border">
          <h3 className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-semibold">Destination / Production</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className={head}>Item</th><th className={`${head} text-right`}>Good</th><th className={`${head} text-right`}>Rejected</th>{review.costed && <><th className={`${head} text-right`}>Share</th><th className={`${head} text-right`}>Allocated</th><th className={`${head} text-right`}>Per good unit</th></>}</tr></thead>
            <tbody>{review.outputs.map((o) => (
              <tr key={o.ingredientId} className="border-t border-border">
                <td className="px-2 py-1.5">{o.name}{o.location ? <span className="block text-xs text-muted-foreground">into {o.location}</span> : null}{o.yieldPercent ? <span className="block text-xs text-muted-foreground">yield {o.yieldPercent}% of plan {o.expected}</span> : null}</td>
                <td className="px-2 text-right tabular-nums">+{o.good} {o.unit}</td>
                <td className="px-2 text-right tabular-nums">{Number(o.rejected) > 0 ? `${o.rejected} (${o.rejectRate}%)` : "–"}</td>
                {review.costed && <><td className="px-2 text-right tabular-nums">{o.percent ? `${Number(o.percent).toFixed(1)}%` : "–"}</td>
                <td className="px-2 text-right tabular-nums">{money(o.allocatedCost)}</td>
                <td className="px-2 text-right font-semibold tabular-nums">{money(o.unitCost)}</td></>}
              </tr>))}</tbody>
          </table></div>
        </section>
      </div>
      {!review.costed && <p className="text-xs text-muted-foreground">Costing is switched off: this voucher records quantities only. No costs were applied.</p>}
      {review.costed && (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Material cost</dt><dd className="tabular-nums">{money(review.ingredientCost)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Additional costs{Number(review.recovery) > 0 ? " (net of recovery)" : ""}</dt><dd className="tabular-nums">{money(review.additionalCost)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Total batch cost</dt><dd className="font-semibold tabular-nums">{money(review.totalCost)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Split method</dt><dd>{review.method === "QUANTITY" ? "By good quantity" : review.method === "MANUAL" ? "Manual percent" : "Single product"}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">Cost per good unit = (materials + additional costs − recovered scrap value) × share ÷ good quantity. {review.rateBasis} {review.wastageTreatment}</p>
        </>
      )}
      {review.costError && (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          <p>{review.costError} Costing is on, so this voucher cannot be posted without a cost for every ingredient. Nothing has been guessed for you.</p>
          <p className="mt-1 text-foreground">To fix it, either press <b>Back to edit</b> and type a <b>Rate</b> for that ingredient (used for this voucher), or receive the ingredient with a unit cost on a Purchase Order (Inventory &gt; Purchase Orders &gt; Receive) so it carries an average cost.</p>
        </div>
      )}
      {review.shortages.length > 0 && <p role="alert" className="text-sm text-destructive">Not enough stock: {review.shortages.join("; ")}. Stock is never allowed to go below zero, so fix the count or the quantity first.</p>}
    </div>
  );
}
