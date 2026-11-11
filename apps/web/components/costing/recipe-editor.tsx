"use client";

import {
  costModifierLines,
  costRecipe,
  profitability,
  suggestPrice,
  type CostIngredient,
  type CostUnit,
  type Overhead,
} from "@nodedr-restaurant/types";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import {
  useAcknowledgeCost,
  useApplyPrice,
  useCostingBundle,
  useMenuItemCosting,
  useSaveMenuItemCosting,
  useSetOptionIngredients,
  type CostedOption,
  type MenuItemCostingView,
} from "@/hooks/use-costing";
import { useSetTracking } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/lib/toast";

const UNITS: CostUnit[] = ["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"];
const selectClass = "h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground";
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

interface Line {
  ingredientId: string;
  quantity: string;
  unit: CostUnit | "";
}
interface OverheadRow {
  kind: Overhead["kind"];
  amount: string;
  basis: Overhead["basis"];
}

const money = (v: number | null, cur = "INR") => (v === null ? "—" : formatCurrency(v, cur));

/** Loads the item's saved costing, then mounts the form so its initial state comes straight from props. */
export function RecipeEditor({ branchId, itemId, isCombo }: { branchId: string | null; itemId: string; isCombo: boolean }) {
  const { data: view, isLoading } = useMenuItemCosting(branchId, isCombo ? null : itemId);
  const { data: bundle } = useCostingBundle(branchId, !isCombo);
  if (isCombo) {
    return (
      <p className="rounded-lg border border-border px-3 py-2.5 text-xs text-muted-foreground">
        Combos are costed through their component items. Open each component to set its recipe.
      </p>
    );
  }
  if (isLoading || !view || !bundle) return <p className="text-xs text-muted-foreground">Loading recipe…</p>;
  return <Form key={`${itemId}:${view.version}:${view.price}`} branchId={branchId} view={view} ingredients={bundle.ingredients} />;
}

function Form({ branchId, view, ingredients }: { branchId: string | null; view: MenuItemCostingView; ingredients: CostIngredient[] }) {
  const { data: me } = useCurrentUser();
  const canPrice = hasPermission(me?.user, "menu.manage");
  const save = useSaveMenuItemCosting(branchId, view.menuItemId);
  const setTracking = useSetTracking(branchId, view.menuItemId);
  const apply = useApplyPrice(branchId, view.menuItemId);
  const ack = useAcknowledgeCost(branchId, view.menuItemId);
  const setOption = useSetOptionIngredients(branchId);

  const [mode, setMode] = useState(view.tracking.inventoryTracking);
  const [lines, setLines] = useState<Line[]>(view.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), unit: l.unit ?? "" })));
  const [batch, setBatch] = useState(String(view.config.batchOutputQty));
  const [overheads, setOverheads] = useState<OverheadRow[]>(
    view.config.overheads.map((o) => ({ kind: o.kind, amount: String(o.amount), basis: o.basis })),
  );
  const [halfRatio, setHalfRatio] = useState(String(view.config.halfPortionRatio));
  const [margin, setMargin] = useState(view.config.targetMarginPercent == null ? "" : String(view.config.targetMarginPercent));
  const [markup, setMarkup] = useState(view.config.targetMarkupPercent == null ? "" : String(view.config.targetMarkupPercent));
  const [method, setMethod] = useState<"MARGIN" | "MARKUP">("MARGIN");
  const [directId, setDirectId] = useState(view.tracking.stockIngredientId ?? "");
  const [directQty, setDirectQty] = useState(String(view.tracking.stockQuantityPerSale));
  const [conflict, setConflict] = useState(false);
  const [planned, setPlanned] = useState("");

  const map = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const usable = ingredients.filter((i) => i.id !== undefined);

  // Live preview with the same engine the server uses, so what you see is what is saved.
  const cleanLines = lines
    .filter((l) => l.ingredientId && num(l.quantity) > 0)
    .map((l) => ({ ingredientId: l.ingredientId, quantity: num(l.quantity), unit: l.unit || null }));
  const cleanOver: Overhead[] = overheads
    .filter((o) => num(o.amount) > 0)
    .map((o) => ({ kind: o.kind, amount: num(o.amount), basis: o.basis }));
  const live = costRecipe({ lines: cleanLines, batchOutputQty: num(batch), overheads: cleanOver }, map);
  const cost = mode === "RECIPE" ? live.costPerPortion : view.cost.costPerPortion;
  const badLines = lines.filter((l) => l.ingredientId && !(num(l.quantity) > 0));

  const pct = num(method === "MARGIN" ? margin : markup);
  const suggestion =
    cost !== null && Number.isFinite(pct)
      ? suggestPrice({ cost, method, percent: pct, taxRatePercent: view.taxRatePercent, taxMode: view.taxMode })
      : null;
  const prof =
    cost === null ? null : profitability({ cost, listedPrice: view.price, taxRatePercent: view.taxRatePercent, taxMode: view.taxMode });

  const submit = async (overwrite = false) => {
    try {
      if (mode === "RECIPE") {
        if (badLines.length) return toast.error("Every ingredient needs a quantity above zero");
        if (!(num(batch) > 0)) return toast.error("Batch output must be above zero");
        await setTracking.mutateAsync({ inventoryTracking: "RECIPE" });
        await save.mutateAsync({
          lines: cleanLines,
          batchOutputQty: num(batch),
          overheads: cleanOver,
          halfPortionRatio: num(halfRatio) > 0 ? num(halfRatio) : 0.5,
          targetMarginPercent: Number.isFinite(num(margin)) ? num(margin) : null,
          targetMarkupPercent: Number.isFinite(num(markup)) ? num(markup) : null,
          alertDropPoints: view.config.alertDropPoints,
          baseVersion: overwrite ? undefined : view.version,
        });
      } else if (mode === "DIRECT") {
        if (!directId) return toast.error("Pick the stock item this dish sells");
        await setTracking.mutateAsync({ inventoryTracking: "DIRECT", stockIngredientId: directId, stockQuantityPerSale: num(directQty) || 1 });
      } else {
        await setTracking.mutateAsync({ inventoryTracking: "NONE" });
      }
      setConflict(false);
      toast.success("Recipe saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(true);
      else toast.error(err instanceof ApiError ? err.message : "Could not save the recipe");
    }
  };

  const applyPrice = async () => {
    if (!suggestion) return;
    if (!window.confirm(`Change the selling price from ${money(view.price)} to ${money(suggestion.listedPrice)}?`)) return;
    try {
      await apply.mutateAsync({ price: suggestion.listedPrice, expectedCurrentPrice: view.price, target: "FULL" });
      toast.success("Selling price updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not change the price");
    }
  };

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ingName = (id: string) => map.get(id)?.name ?? "";
  const ingUnit = (id: string) => (map.get(id)?.unit ?? "").toLowerCase();

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-3" aria-label="Recipe and cost">
      <div>
        <h3 className="text-sm font-medium text-foreground">Recipe &amp; cost</h3>
        <p className="text-xs text-muted-foreground">What it costs to make, what it earns, and how stock is used when it sells.</p>
      </div>

      {view.alert.level === "WATCH" || view.alert.level === "LOSS" ? (
        <div role="alert" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex flex-1 flex-col gap-1">
            <p className="font-medium text-foreground">{view.alert.message}</p>
            <p className="text-xs text-muted-foreground">
              Margin was {view.alert.baselineMarginPercent ?? "—"}% when the price was last reviewed, now {view.alert.currentMarginPercent ?? "—"}%. The price has not been changed.
            </p>
            <Button type="button" size="sm" variant="outline" className="w-fit" disabled={ack.isPending} onClick={() => ack.mutate()}>
              Price is fine — stop warning
            </Button>
          </div>
        </div>
      ) : null}

      {conflict && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-foreground">Someone else changed this recipe after you opened it.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>Reload their version</Button>
            <Button type="button" size="sm" onClick={() => submit(true)}>Keep mine and overwrite</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How stock is used">
        {([
          ["NONE", "Not tracked"],
          ["RECIPE", "Made to order"],
          ["DIRECT", "Prepared stock"],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            onClick={() => setMode(v)}
            className={
              "min-h-11 rounded-lg border px-2 text-sm " +
              (mode === v ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "RECIPE"
          ? "Raw ingredients are taken off the shelf when the bill is paid."
          : mode === "DIRECT"
            ? "Finished stock (a bottle, or a batch you cooked ahead under Preparations) is taken when sold. Its raw ingredients were already used when it was made."
            : "Selling this never changes stock."}
      </p>

      {mode === "DIRECT" && (
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="direct-id">Stock item sold</Label>
            <select id="direct-id" className={selectClass} value={directId} onChange={(e) => setDirectId(e.target.value)}>
              <option value="">Choose…</option>
              {usable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit.toLowerCase()}){(i as { kind?: string }).kind === "PREPARED" ? " · prepared" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="direct-qty">Per sale</Label>
            <Input id="direct-qty" inputMode="decimal" className="h-11" value={directQty} onChange={(e) => setDirectQty(e.target.value)} />
          </div>
        </div>
      )}

      {mode === "RECIPE" && (
        <>
          <div className="flex flex-col gap-2">
            <Label>Ingredients <span className="font-normal text-muted-foreground">(usable amount for the whole batch)</span></Label>
            {lines.map((l, i) => {
              const cl = live.lines.find((x) => x.ingredientId === l.ingredientId);
              const bad = l.ingredientId && !(num(l.quantity) > 0);
              return (
                <div key={i} className="flex flex-col gap-1 rounded-lg border border-border p-2">
                  <select aria-label="Ingredient" className={selectClass} value={l.ingredientId} onChange={(e) => setLine(i, { ingredientId: e.target.value, unit: "" })}>
                    <option value="">Choose ingredient…</option>
                    {usable.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-[1fr_7rem_2.75rem] gap-2">
                    <Input
                      aria-label="Quantity"
                      aria-invalid={!!bad}
                      inputMode="decimal"
                      className="h-11"
                      placeholder="Quantity"
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                    />
                    <select aria-label="Unit" className={selectClass} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as CostUnit | "" })}>
                      <option value="">{ingUnit(l.ingredientId) || "unit"}</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>{u.toLowerCase()}</option>
                      ))}
                    </select>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${ingName(l.ingredientId) || "line"}`} className="h-11 w-11" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {cl && (
                    <p className={"text-xs " + (cl.ok ? "text-muted-foreground" : "text-destructive")}>
                      {cl.ok
                        ? `${money(cl.lineCost)} · ${cl.unitCost?.label}${cl.yieldLossCost ? ` · includes ${money(cl.yieldLossCost)} lost to ${Math.round(100 - (cl.unitCost?.yieldPercent ?? 100))}% trim` : ""}`
                        : (live.issues.find((x) => x.ingredientId === l.ingredientId)?.message ?? "Cannot be priced")}
                    </p>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setLines((ls) => [...ls, { ingredientId: "", quantity: "", unit: "" }])}>
              <Plus className="mr-1 h-4 w-4" /> Add ingredient
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="batch">Portions per batch</Label>
              <Input id="batch" inputMode="decimal" className="h-11" value={batch} onChange={(e) => setBatch(e.target.value)} aria-invalid={!(num(batch) > 0)} />
            </div>
            {view.halfPrice != null && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="half">Half = share of full</Label>
                <Input id="half" inputMode="decimal" className="h-11" value={halfRatio} onChange={(e) => setHalfRatio(e.target.value)} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Other costs <span className="font-normal text-muted-foreground">(optional)</span></Label>
            {overheads.map((o, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_2.75rem] gap-2">
                <select aria-label="Kind" className={selectClass} value={o.kind} onChange={(e) => setOverheads((os) => os.map((x, j) => (j === i ? { ...x, kind: e.target.value as Overhead["kind"] } : x)))}>
                  <option value="PACKAGING">Packaging</option>
                  <option value="LABOUR">Labour</option>
                  <option value="ENERGY">Energy / gas</option>
                  <option value="OTHER">Other</option>
                </select>
                <Input aria-label="Amount" inputMode="decimal" className="h-11" placeholder="₹" value={o.amount} onChange={(e) => setOverheads((os) => os.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove cost" className="h-11 w-11" onClick={() => setOverheads((os) => os.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <select aria-label="Applies" className={selectClass + " col-span-3"} value={o.basis} onChange={(e) => setOverheads((os) => os.map((x, j) => (j === i ? { ...x, basis: e.target.value as Overhead["basis"] } : x)))}>
                  <option value="PER_BATCH">per batch</option>
                  <option value="PER_PORTION">per portion</option>
                </select>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOverheads((os) => [...os, { kind: "PACKAGING", amount: "", basis: "PER_PORTION" }])}>
              <Plus className="mr-1 h-4 w-4" /> Add packaging, labour, energy…
            </Button>
          </div>
        </>
      )}

      {/* Cost breakdown: four separate figures, never blended. */}
      <div className="rounded-lg bg-secondary/50 p-3 text-sm" aria-live="polite">
        {mode === "RECIPE" ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Ingredient cost (batch)</dt><dd className="text-right">{money(live.ingredientCost)}</dd>
            {live.yieldLossCost > 0 && (<><dt className="pl-3 text-xs text-muted-foreground">of which trim loss</dt><dd className="text-right text-xs text-muted-foreground">{money(live.yieldLossCost)}</dd></>)}
            <dt className="text-muted-foreground">Other costs (batch)</dt><dd className="text-right">{money(live.overheadCost)}</dd>
            <dt className="text-muted-foreground">Batch cost</dt><dd className="text-right font-medium">{money(live.batchCost)}</dd>
            <dt className="text-muted-foreground">Cost per portion</dt><dd className="text-right font-semibold">{money(live.costPerPortion)}</dd>
            <dt className="text-muted-foreground">
              <label htmlFor="planned">Total to make</label>
            </dt>
            <dd className="flex items-center justify-end gap-1">
              <Input id="planned" inputMode="decimal" className="h-8 w-16 text-right" placeholder={String(live.portions || 1)} value={planned} onChange={(e) => setPlanned(e.target.value)} />
              <span>= {live.costPerPortion === null ? "—" : money(Math.round(live.costPerPortion * (num(planned) || live.portions || 0) * 100) / 100)}</span>
            </dd>
          </dl>
        ) : (
          <p>Cost per portion: <strong>{money(view.cost.costPerPortion)}</strong>{view.cost.stockItem ? ` · from ${view.cost.stockItem.name} (${view.cost.stockItem.label})` : mode === "NONE" ? " — add a recipe to see it" : ""}</p>
        )}
        {mode === "RECIPE" && !live.complete && (
          <p className="mt-2 text-xs text-destructive">
            Cost is incomplete — {live.issues[0]?.message ?? "fix the lines above"}. No price suggestion until every line is priced.
          </p>
        )}
      </div>

      {/* Selling price & profitability */}
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Selling price now</span>
          <span className="font-medium">{money(view.price)} <span className="text-xs text-muted-foreground">{view.taxMode === "INCLUSIVE" ? "incl. tax" : "+ tax on top"}</span></span>
        </div>
        {prof ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Revenue before tax</dt><dd className="text-right">{money(prof.netRevenue)}</dd>
            <dt className="text-muted-foreground">Gross profit</dt><dd className="text-right">{money(prof.grossProfit)}</dd>
            <dt className="text-muted-foreground">Food cost</dt><dd className="text-right">{prof.foodCostPercent ?? "—"}%</dd>
            <dt className="text-muted-foreground">Gross margin</dt><dd className="text-right">{prof.grossMarginPercent ?? "—"}%</dd>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Profit appears once the cost is fully priced.</p>
        )}

        <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
          <p className="font-medium text-foreground">Suggested price</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pricing method">
            {(["MARGIN", "MARKUP"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={"min-h-11 rounded-lg border px-2 text-sm " + (method === m ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>
                {m === "MARGIN" ? "Target margin" : "Markup on cost"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input aria-label={method === "MARGIN" ? "Target margin percent" : "Markup percent"} inputMode="decimal" className="h-11 w-24"
              value={method === "MARGIN" ? margin : markup} onChange={(e) => (method === "MARGIN" ? setMargin(e.target.value) : setMarkup(e.target.value))} />
            <span>%</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {method === "MARGIN" ? "Margin price = cost ÷ (1 − margin%). A 60% margin means 60% of the price (before tax) is profit." : "Markup price = cost × (1 + markup%). A 60% markup adds 60% of the cost on top."}
          </p>
          {suggestion ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/50 p-3">
              <div>
                <p className="text-base font-semibold">{money(suggestion.priceBeforeTax)} <span className="text-xs font-normal text-muted-foreground">before tax</span></p>
                {view.taxRatePercent > 0 && <p className="text-xs text-muted-foreground">Enter as {money(suggestion.listedPrice)} {view.taxMode === "INCLUSIVE" ? "(includes tax)" : "(tax is added at billing)"}</p>}
              </div>
              {canPrice ? (
                <Button type="button" size="sm" disabled={apply.isPending || Math.abs(suggestion.listedPrice - view.price) < 0.005} onClick={applyPrice}>
                  Use this price
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Changing prices needs Manage Menu.</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{cost === null ? "Needs a fully priced cost." : "Enter a valid percentage (margin must be under 100%)."}</p>
          )}
          <p className="text-xs text-muted-foreground">The menu price is never changed unless you press “Use this price”.</p>
        </div>
      </div>

      <Button type="button" onClick={() => submit()} disabled={save.isPending || setTracking.isPending} className="h-11">
        {save.isPending || setTracking.isPending ? "Saving…" : "Save recipe"}
      </Button>

      {view.modifiers.length > 0 && mode !== "NONE" && (
        <OptionsSection options={view.modifiers} ingredients={ingredients} map={map} onSave={(id, ls) => setOption.mutateAsync({ modifierId: id, lines: ls })} />
      )}
    </section>
  );
}

function OptionsSection({
  options, ingredients, map, onSave,
}: {
  options: CostedOption[];
  ingredients: CostIngredient[];
  map: Map<string, CostIngredient>;
  onSave: (id: string, lines: { ingredientId: string; quantity: number; unit: CostUnit | null }[]) => Promise<unknown>;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h4 className="text-sm font-medium text-foreground">Options that use ingredients</h4>
      <p className="text-xs text-muted-foreground">e.g. “Extra cheese” adds 30 g; “No onion” removes 20 g (enter a negative amount).</p>
      {options.map((o) => (
        <OptionRow key={o.id} option={o} ingredients={ingredients} map={map} onSave={onSave} />
      ))}
    </div>
  );
}

function OptionRow({
  option, ingredients, map, onSave,
}: {
  option: CostedOption;
  ingredients: CostIngredient[];
  map: Map<string, CostIngredient>;
  onSave: (id: string, lines: { ingredientId: string; quantity: number; unit: CostUnit | null }[]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(option.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), unit: l.unit ?? "" })));
  const clean = lines.filter((l) => l.ingredientId && Number.isFinite(num(l.quantity)) && num(l.quantity) !== 0)
    .map((l) => ({ ingredientId: l.ingredientId, quantity: num(l.quantity), unit: (l.unit || null) as CostUnit | null }));
  const mc = costModifierLines(clean, map);
  return (
    <div className="rounded-lg border border-border p-2">
      <button type="button" className="flex min-h-11 w-full items-center justify-between text-left text-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{option.name} <span className="text-xs text-muted-foreground">({option.groupName})</span></span>
        <span className="text-xs text-muted-foreground">{clean.length ? `cost ${mc.cost === null ? "—" : money(mc.cost)}` : "no ingredients"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 pt-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_2.75rem] gap-2">
              <select aria-label="Ingredient" className={selectClass} value={l.ingredientId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))}>
                <option value="">Ingredient…</option>
                {ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <Input aria-label="Quantity" inputMode="decimal" className="h-11" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <select aria-label="Unit" className={selectClass} value={l.unit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: e.target.value as CostUnit | "" } : x)))}>
                <option value="">{(map.get(l.ingredientId)?.unit ?? "unit").toLowerCase()}</option>
                {UNITS.map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}
              </select>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove" className="h-11 w-11" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { ingredientId: "", quantity: "", unit: "" }])}><Plus className="mr-1 h-4 w-4" />Add</Button>
            <Button type="button" size="sm" onClick={async () => { try { await onSave(option.id, clean); toast.success("Option saved"); } catch (e) { toast.error(e instanceof ApiError ? e.message : "Could not save"); } }}>Save option</Button>
          </div>
        </div>
      )}
    </div>
  );
}
