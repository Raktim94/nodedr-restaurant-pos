// Recipe costing engine - PURE functions, no database, no I/O.
//
// One implementation shared by the server (NestJS) and the phone (the
// standalone POS runs the same logic offline: mobile/www/pos/lib/costing.js is
// generated from this file by scripts/gen-mobile-costing.mjs and a test fails
// if it drifts). Both are checked against costing-vectors.json.
//
// Money rule: nothing is rounded while computing; results are rounded once at
// the boundary (4 decimals for cost, 2 for prices) so rounding never compounds.
//
// Wastage rule (the "exactly once" rule): the ONLY place wastage lives is an
// ingredient's usable-yield %. A recipe line states the USABLE quantity it
// needs; the engine grosses it up by yield exactly once, both for cost and for
// the raw quantity deducted from stock. Cooking loss is expressed by the batch
// output (portions), never by a second wastage figure.

// --- Units -------------------------------------------------------------------

export type CostUnit =
  | "KG"
  | "G"
  | "L"
  | "ML"
  | "PIECE"
  | "DOZEN"
  | "PACK"
  | "BOX";

type Dimension = "MASS" | "VOLUME" | "COUNT" | "PACK" | "BOX";

// factor = how many of the dimension's base unit (g / ml / piece) one unit is.
const UNITS: Record<CostUnit, { dim: Dimension; factor: number }> = {
  KG: { dim: "MASS", factor: 1000 },
  G: { dim: "MASS", factor: 1 },
  L: { dim: "VOLUME", factor: 1000 },
  ML: { dim: "VOLUME", factor: 1 },
  PIECE: { dim: "COUNT", factor: 1 },
  DOZEN: { dim: "COUNT", factor: 12 },
  // Packs and boxes only convert to themselves unless the ingredient says
  // how many grams / pieces one holds (an ingredient-specific conversion).
  PACK: { dim: "PACK", factor: 1 },
  BOX: { dim: "BOX", factor: 1 },
};

export const COST_UNITS = Object.keys(UNITS) as CostUnit[];

/** "1 <stock unit> = per <unit>", e.g. 1 L of oil = 920 G. Ingredient-specific. */
export interface UnitConversion {
  unit: CostUnit;
  per: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

const sameDim = (a: CostUnit, b: CostUnit) => UNITS[a].dim === UNITS[b].dim;
const direct = (q: number, from: CostUnit, to: CostUnit) => (q * UNITS[from].factor) / UNITS[to].factor;

/**
 * Converts a quantity between units. Same-dimension units (kg/g, l/ml,
 * piece/dozen) convert freely. Weight <-> volume <-> count only converts
 * through an ingredient-specific conversion (stockUnit + conversions); with
 * none it returns null - it never guesses a density.
 */
export function convertQty(
  qty: number,
  from: CostUnit,
  to: CostUnit,
  stockUnit?: CostUnit,
  conversions: readonly UnitConversion[] = [],
): number | null {
  if (!Number.isFinite(qty)) return null;
  if (sameDim(from, to)) return direct(qty, from, to);
  if (!stockUnit) return null;
  // Step 1: express the quantity in the ingredient's stock unit.
  let inStock: number | null = null;
  if (sameDim(from, stockUnit)) inStock = direct(qty, from, stockUnit);
  else {
    const c = conversions.find((x) => sameDim(x.unit, from) && x.per > 0);
    if (c) inStock = direct(qty, from, c.unit) / c.per;
  }
  if (inStock === null) return null;
  // Step 2: stock unit -> target.
  if (sameDim(stockUnit, to)) return direct(inStock, stockUnit, to);
  const c = conversions.find((x) => sameDim(x.unit, to) && x.per > 0);
  if (!c) return null;
  return direct(inStock * c.per, c.unit, to);
}

// --- Ingredient unit cost ----------------------------------------------------

export type CostMethod = "AVERAGE" | "MANUAL" | "RECIPE";

export interface CostIngredient {
  id: string;
  name: string;
  /** Stock unit: currentStock and costPerUnit are expressed in this unit. */
  unit: CostUnit;
  /** Weighted-average cost per stock unit kept by goods receipts / production. */
  costPerUnit: number;
  costMethod: CostMethod;
  purchaseQuantity?: number | null;
  purchaseUnit?: CostUnit | null;
  purchasePrice?: number | null;
  /** Usable yield, % of the purchased quantity left after trimming (0 < y <= 100). */
  yieldPercent: number;
  conversions?: readonly UnitConversion[];
  /** Set for prepared ingredients (sauces, dough...): the recipe that makes them. */
  preparation?: CostPreparation | null;
}

export type CostSource = "AVERAGE" | "MANUAL" | "MANUAL_FALLBACK" | "RECIPE" | "MISSING";

export interface UnitCost {
  /** Cost of one stock unit BEFORE yield loss, or null if it cannot be priced. */
  rawPerStockUnit: number | null;
  /** Cost of one USABLE stock unit (raw cost / yield). null if unpriced. */
  usablePerStockUnit: number | null;
  source: CostSource;
  yieldPercent: number;
  /** Plain-words label for the UI: which method produced this cost. */
  label: string;
}

export interface CostLineInput {
  ingredientId: string;
  /** USABLE quantity needed per batch, in `unit` (default: the ingredient's stock unit). */
  quantity: number;
  unit?: CostUnit | null;
}

export type OverheadKind = "PACKAGING" | "LABOUR" | "ENERGY" | "OTHER";
export type OverheadBasis = "PER_BATCH" | "PER_PORTION";

export interface Overhead {
  kind: OverheadKind;
  label?: string;
  amount: number;
  basis: OverheadBasis;
}

export interface CostPreparation {
  lines: readonly CostLineInput[];
  /** Output of one batch, in the output ingredient's stock unit. */
  batchOutputQty: number;
  overheads?: readonly Overhead[];
}

export type IssueCode =
  | "MISSING_PRICE"
  | "INCOMPATIBLE_UNIT"
  | "INVALID_QUANTITY"
  | "INVALID_YIELD"
  | "ZERO_OUTPUT"
  | "UNKNOWN_INGREDIENT"
  | "CIRCULAR";

export interface CostIssue {
  code: IssueCode;
  ingredientId?: string;
  message: string;
}

const validYield = (y: number) => Number.isFinite(y) && y > 0 && y <= 100;

export type IngredientMap = ReadonlyMap<string, CostIngredient>;

/** Cost of the ingredient's *purchase* quantity expressed per stock unit, or null. */
function manualPerStockUnit(ing: CostIngredient): number | null {
  const q = ing.purchaseQuantity ?? 0;
  const price = ing.purchasePrice;
  const pu = ing.purchaseUnit ?? ing.unit;
  if (price == null || !(price >= 0) || !(q > 0)) return null;
  const inStock = convertQty(q, pu, ing.unit, ing.unit, ing.conversions ?? []);
  if (inStock === null || !(inStock > 0)) return null;
  return price / inStock;
}

/**
 * The effective unit cost of an ingredient and which method produced it.
 * AVERAGE reuses the inventory valuation (weighted average kept by goods
 * receipts); with no purchase history yet it falls back to the manual
 * purchase cost and says so. RECIPE (prepared items) prices from the
 * preparation's own recipe, recursively, with cycle detection.
 */
export function effectiveUnitCost(
  ing: CostIngredient,
  ingredients: IngredientMap,
  issues: CostIssue[] = [],
  trail: readonly string[] = [],
): UnitCost {
  const y = ing.yieldPercent;
  if (!validYield(y)) {
    issues.push({ code: "INVALID_YIELD", ingredientId: ing.id, message: `${ing.name}: usable yield must be above 0% and at most 100%` });
    return { rawPerStockUnit: null, usablePerStockUnit: null, source: "MISSING", yieldPercent: y, label: "Invalid yield" };
  }
  const finish = (raw: number | null, source: CostSource, label: string): UnitCost => ({
    rawPerStockUnit: raw === null ? null : raw,
    usablePerStockUnit: raw === null ? null : raw / (y / 100),
    source,
    yieldPercent: y,
    label,
  });

  if (ing.costMethod === "RECIPE" && ing.preparation) {
    if (trail.includes(ing.id)) {
      issues.push({ code: "CIRCULAR", ingredientId: ing.id, message: `${ing.name} is used inside its own recipe` });
      return finish(null, "MISSING", "Circular recipe");
    }
    const r = costRecipe(ing.preparation, ingredients, { trail: [...trail, ing.id] });
    for (const i of r.issues) issues.push(i);
    if (r.costPerPortion === null) return finish(null, "MISSING", "Recipe cost incomplete");
    return finish(r.costPerPortion, "RECIPE", "From its recipe (live)");
  }
  if (ing.costMethod === "MANUAL") {
    const m = manualPerStockUnit(ing);
    if (m === null) {
      issues.push({ code: "MISSING_PRICE", ingredientId: ing.id, message: `${ing.name} has no purchase price` });
      return finish(null, "MISSING", "No price set");
    }
    return finish(m, "MANUAL", "Manual purchase cost");
  }
  // AVERAGE (default): reuse the existing weighted-average valuation.
  if (ing.costPerUnit > 0) return finish(ing.costPerUnit, "AVERAGE", "Weighted average of purchases");
  const m = manualPerStockUnit(ing);
  if (m !== null) return finish(m, "MANUAL_FALLBACK", "Manual cost (no purchases received yet)");
  issues.push({ code: "MISSING_PRICE", ingredientId: ing.id, message: `${ing.name} has no purchase price` });
  return finish(null, "MISSING", "No price set");
}

// --- Recipe cost -------------------------------------------------------------

export interface CostLine {
  ingredientId: string;
  name: string;
  /** Usable quantity per batch, as entered. */
  quantity: number;
  unit: CostUnit;
  /** The same usable quantity in the ingredient's stock unit. */
  usableStockQty: number | null;
  /** Raw stock to take off the shelf = usable / yield. Used for stock deduction. */
  rawStockQty: number | null;
  /** Cost of the usable quantity at the pre-yield price (what you'd pay with no loss). */
  costBeforeYield: number | null;
  /** Extra cost caused by trimming loss (usable cost - cost before yield). */
  yieldLossCost: number | null;
  /** costBeforeYield + yieldLossCost: the line's cost per batch. */
  lineCost: number | null;
  unitCost: UnitCost | null;
  ok: boolean;
}

export interface RecipeCost {
  lines: CostLine[];
  /** Σ line costs per batch (yield loss already inside, counted once). */
  ingredientCost: number;
  /** Yield-loss share of ingredientCost, shown separately for clarity. */
  yieldLossCost: number;
  overheadCost: number;
  overheadBreakdown: { kind: OverheadKind; label: string; amount: number }[];
  /** ingredientCost + overheadCost: what one batch costs. */
  batchCost: number;
  portions: number;
  /** null when output is zero or any line could not be priced. */
  costPerPortion: number | null;
  /** True when every line is priced, compatible and valid. */
  complete: boolean;
  issues: CostIssue[];
}

/**
 * Costs one recipe batch. `portions` (batchOutputQty) divides the batch cost;
 * per-batch overheads are spread over it, per-portion overheads are added once
 * per portion. A line that cannot be priced is listed with its issue and the
 * result is marked incomplete (cost per portion is null rather than a figure
 * that silently understates the real cost).
 */
export function costRecipe(
  recipe: CostPreparation,
  ingredients: IngredientMap,
  opts: { trail?: readonly string[] } = {},
): RecipeCost {
  const trail = opts.trail ?? [];
  const issues: CostIssue[] = [];
  const lines: CostLine[] = [];
  let ingredientCost = 0;
  let yieldLoss = 0;
  let complete = true;

  for (const l of recipe.lines) {
    const ing = ingredients.get(l.ingredientId);
    if (!ing) {
      issues.push({ code: "UNKNOWN_INGREDIENT", ingredientId: l.ingredientId, message: "Ingredient not found" });
      complete = false;
      continue;
    }
    const unit = (l.unit ?? ing.unit) as CostUnit;
    const bad = (code: IssueCode, message: string): CostLine => {
      issues.push({ code, ingredientId: ing.id, message });
      complete = false;
      return {
        ingredientId: ing.id, name: ing.name, quantity: l.quantity, unit,
        usableStockQty: null, rawStockQty: null, costBeforeYield: null, yieldLossCost: null, lineCost: null,
        unitCost: null, ok: false,
      };
    };
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) {
      lines.push(bad("INVALID_QUANTITY", `${ing.name}: quantity must be above zero`));
      continue;
    }
    if (trail.includes(ing.id)) {
      lines.push(bad("CIRCULAR", `${ing.name} is used inside its own recipe`));
      continue;
    }
    const stockQty = convertQty(l.quantity, unit, ing.unit, ing.unit, ing.conversions ?? []);
    if (stockQty === null) {
      lines.push(
        bad("INCOMPATIBLE_UNIT", `${ing.name}: cannot convert ${unit.toLowerCase()} to ${ing.unit.toLowerCase()} - set a conversion on the ingredient`),
      );
      continue;
    }
    const uc = effectiveUnitCost(ing, ingredients, issues, trail);
    if (uc.usablePerStockUnit === null || uc.rawPerStockUnit === null) {
      complete = false;
      lines.push({
        ingredientId: ing.id, name: ing.name, quantity: l.quantity, unit,
        usableStockQty: stockQty, rawStockQty: stockQty / (ing.yieldPercent / 100 || 1),
        costBeforeYield: null, yieldLossCost: null, lineCost: null, unitCost: uc, ok: false,
      });
      continue;
    }
    const before = stockQty * uc.rawPerStockUnit;
    const total = stockQty * uc.usablePerStockUnit;
    ingredientCost += total;
    yieldLoss += total - before;
    lines.push({
      ingredientId: ing.id, name: ing.name, quantity: l.quantity, unit,
      usableStockQty: stockQty, rawStockQty: stockQty / (ing.yieldPercent / 100),
      costBeforeYield: round4(before), yieldLossCost: round4(total - before), lineCost: round4(total),
      unitCost: uc, ok: true,
    });
  }

  const portions = recipe.batchOutputQty;
  const zero = !Number.isFinite(portions) || !(portions > 0);
  if (zero) {
    issues.push({ code: "ZERO_OUTPUT", message: "Batch output must be above zero" });
    complete = false;
  }
  const overheadBreakdown: RecipeCost["overheadBreakdown"] = [];
  let overheadCost = 0;
  for (const o of recipe.overheads ?? []) {
    if (!Number.isFinite(o.amount) || o.amount < 0) continue;
    const amount = o.basis === "PER_PORTION" ? o.amount * (zero ? 0 : portions) : o.amount;
    overheadCost += amount;
    overheadBreakdown.push({ kind: o.kind, label: o.label || o.kind.toLowerCase(), amount: round4(amount) });
  }
  const batchCost = ingredientCost + overheadCost;
  return {
    lines,
    ingredientCost: round4(ingredientCost),
    yieldLossCost: round4(yieldLoss),
    overheadCost: round4(overheadCost),
    overheadBreakdown,
    batchCost: round4(batchCost),
    portions: zero ? 0 : portions,
    costPerPortion: zero || !complete ? null : round4(batchCost / portions),
    complete,
    issues,
  };
}

/** Total cost to produce `portions` portions at the recipe's cost per portion. */
export function productionCost(costPerPortion: number | null, portions: number): number | null {
  if (costPerPortion === null || !Number.isFinite(portions) || portions < 0) return null;
  return round2(costPerPortion * portions);
}

// --- Selling price & profitability -------------------------------------------

export type TaxModeCost = "INCLUSIVE" | "EXCLUSIVE";

/** Revenue excluding sales tax for a listed price, honouring the branch's tax mode. */
export function netRevenue(listedPrice: number, taxRatePercent: number, taxMode: TaxModeCost): number {
  if (taxMode === "INCLUSIVE" && taxRatePercent > 0) return listedPrice / (1 + taxRatePercent / 100);
  return listedPrice;
}

/** The price a customer sees for a given ex-tax price. */
export function listedFromNet(netPrice: number, taxRatePercent: number, taxMode: TaxModeCost): number {
  if (taxMode === "INCLUSIVE" && taxRatePercent > 0) return netPrice * (1 + taxRatePercent / 100);
  return netPrice;
}

/** Margin price = cost / (1 - margin%). Invalid (null) for margin outside [0, 100). */
export function marginPrice(cost: number, marginPercent: number): number | null {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(marginPercent)) return null;
  if (marginPercent < 0 || marginPercent >= 100) return null;
  return (cost * 100) / (100 - marginPercent);
}

/** Markup price = cost * (1 + markup%). Invalid (null) for negative markup. */
export function markupPrice(cost: number, markupPercent: number): number | null {
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(markupPercent) || markupPercent < 0) return null;
  return (cost * (100 + markupPercent)) / 100;
}

export interface Profitability {
  listedPrice: number;
  /** Selling price excluding sales tax - the revenue margin is measured on. */
  netRevenue: number;
  taxAmount: number;
  cost: number;
  grossProfit: number;
  /** cost / net revenue, %. */
  foodCostPercent: number | null;
  /** gross profit / net revenue, %. */
  grossMarginPercent: number | null;
  /** gross profit / cost, % (how far above cost). */
  markupPercent: number | null;
}

export function profitability(args: {
  cost: number;
  listedPrice: number;
  taxRatePercent: number;
  taxMode: TaxModeCost;
}): Profitability {
  const net = netRevenue(args.listedPrice, args.taxRatePercent, args.taxMode);
  const listedWithTax =
    args.taxMode === "EXCLUSIVE" ? listedFromNet(args.listedPrice, args.taxRatePercent, "INCLUSIVE") : args.listedPrice;
  const profit = net - args.cost;
  return {
    listedPrice: round2(args.listedPrice),
    netRevenue: round2(net),
    taxAmount: round2(listedWithTax - net),
    cost: round2(args.cost),
    grossProfit: round2(profit),
    foodCostPercent: net > 0 ? round2((args.cost / net) * 100) : null,
    grossMarginPercent: net > 0 ? round2((profit / net) * 100) : null,
    markupPercent: args.cost > 0 ? round2((profit / args.cost) * 100) : null,
  };
}

export interface PriceSuggestion {
  method: "MARGIN" | "MARKUP";
  /** The % the suggestion was built from. */
  percent: number;
  /** Ex-tax price (revenue). */
  priceBeforeTax: number;
  /** What to enter as the menu price: with tax in INCLUSIVE mode, as-is in EXCLUSIVE mode. */
  listedPrice: number;
}

export function suggestPrice(args: {
  cost: number | null;
  method: "MARGIN" | "MARKUP";
  percent: number;
  taxRatePercent: number;
  taxMode: TaxModeCost;
}): PriceSuggestion | null {
  if (args.cost === null) return null;
  const net = args.method === "MARGIN" ? marginPrice(args.cost, args.percent) : markupPrice(args.cost, args.percent);
  if (net === null) return null;
  return {
    method: args.method,
    percent: args.percent,
    priceBeforeTax: round2(net),
    listedPrice: round2(listedFromNet(net, args.taxRatePercent, args.taxMode)),
  };
}

// --- Margin-erosion warning ---------------------------------------------------

export type MarginAlertLevel = "OK" | "WATCH" | "LOSS" | "UNKNOWN";

export interface MarginAlert {
  level: MarginAlertLevel;
  baselineMarginPercent: number | null;
  currentMarginPercent: number | null;
  /** Percentage points the margin has fallen since the baseline (negative = improved). */
  dropPoints: number | null;
  belowTarget: boolean;
  message: string;
}

/**
 * Compares today's cost with the cost when the price was last reviewed.
 * WATCH when the margin fell by at least `thresholdPoints` or sits under the
 * target; LOSS when the dish now sells below cost.
 */
export function marginAlert(args: {
  baselineCost: number | null;
  currentCost: number | null;
  netRevenue: number;
  thresholdPoints: number;
  targetMarginPercent?: number | null;
}): MarginAlert {
  const { baselineCost, currentCost, netRevenue: rev } = args;
  if (currentCost === null || !(rev > 0)) {
    return { level: "UNKNOWN", baselineMarginPercent: null, currentMarginPercent: null, dropPoints: null, belowTarget: false, message: "Cost is not fully priced yet" };
  }
  const cur = ((rev - currentCost) / rev) * 100;
  const base = baselineCost === null ? null : ((rev - baselineCost) / rev) * 100;
  const drop = base === null ? null : base - cur;
  const belowTarget = args.targetMarginPercent != null && cur < args.targetMarginPercent;
  let level: MarginAlertLevel = "OK";
  let message = "Margin is healthy";
  if (cur < 0) {
    level = "LOSS";
    message = "Selling below cost";
  } else if (drop !== null && drop >= args.thresholdPoints) {
    level = "WATCH";
    message = `Margin fell ${round2(drop)} points since the price was last reviewed`;
  } else if (belowTarget) {
    level = "WATCH";
    message = `Margin ${round2(cur)}% is under the ${args.targetMarginPercent}% target`;
  }
  return {
    level,
    baselineMarginPercent: base === null ? null : round2(base),
    currentMarginPercent: round2(cur),
    dropPoints: drop === null ? null : round2(drop),
    belowTarget,
    message,
  };
}

// --- Cycle detection ------------------------------------------------------------

/**
 * Would making `preparationOutputId` use `candidateIngredientId` create a loop?
 * `usesOf(id)` returns the ingredient ids that preparation `id` consumes.
 */
export function wouldCreateCycle(
  preparationOutputId: string,
  candidateIngredientIds: readonly string[],
  usesOf: (ingredientId: string) => readonly string[],
): boolean {
  const seen = new Set<string>();
  const stack = [...candidateIngredientIds];
  while (stack.length) {
    const id = stack.pop() as string;
    if (id === preparationOutputId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of usesOf(id)) stack.push(next);
  }
  return false;
}

// --- Options (modifiers) and the cost of one sale ----------------------------------

export interface ModifierLineInput {
  ingredientId: string;
  /** Signed usable quantity per portion: positive adds, negative removes ("no onion"). */
  quantity: number;
  unit?: CostUnit | null;
}

export interface ModifierCost {
  /** Signed cost the option adds to one portion; null if any line could not be priced. */
  cost: number | null;
  complete: boolean;
  lines: { ingredientId: string; rawStockQty: number | null; lineCost: number | null }[];
  issues: CostIssue[];
}

/** Cost and raw-stock effect of one option; negative lines subtract (a removal saves money and stock). */
export function costModifierLines(lines: readonly ModifierLineInput[], ingredients: IngredientMap): ModifierCost {
  const out: ModifierCost["lines"] = [];
  const issues: CostIssue[] = [];
  let cost = 0;
  let complete = true;
  for (const l of lines) {
    const sign = l.quantity < 0 ? -1 : 1;
    const r = costRecipe(
      { lines: [{ ingredientId: l.ingredientId, quantity: Math.abs(l.quantity), unit: l.unit }], batchOutputQty: 1 },
      ingredients,
    );
    for (const i of r.issues) issues.push(i);
    const line = r.lines[0];
    if (!r.complete || !line) {
      complete = false;
      out.push({ ingredientId: l.ingredientId, rawStockQty: line && line.rawStockQty !== null ? sign * line.rawStockQty : null, lineCost: null });
      continue;
    }
    cost += sign * r.batchCost;
    out.push({ ingredientId: l.ingredientId, rawStockQty: line.rawStockQty === null ? null : sign * line.rawStockQty, lineCost: round4(sign * r.batchCost) });
  }
  return { cost: complete ? round4(cost) : null, complete, lines: out, issues };
}

/**
 * Production cost of ONE unit sold: the dish's cost per portion scaled by the portion sold
 * (Half = halfPortionRatio) plus the signed cost of every chosen option. null if either part
 * is unknown - a snapshot is only stored when the cost is fully known.
 */
export function unitCostOfSale(args: {
  costPerPortion: number | null;
  portionRatio: number;
  modifierCosts: readonly (number | null)[];
}): number | null {
  if (args.costPerPortion === null) return null;
  let total = args.costPerPortion * args.portionRatio;
  for (const m of args.modifierCosts) {
    if (m === null) return null;
    total += m;
  }
  return round4(Math.max(0, total));
}

// --- Stock quantities for deduction ---------------------------------------------

export interface StockNeed {
  ingredientId: string;
  /** Raw stock units to take off the shelf (yield already applied, once). */
  rawStockQty: number;
}

/**
 * Raw ingredient stock used to make `portions` portions from a recipe batch:
 * every line's raw (yield-adjusted) quantity, scaled by portions / batch output.
 * Lines that cannot be converted are skipped here and reported via issues.
 */
export function stockNeedsForPortions(
  recipe: CostPreparation,
  ingredients: IngredientMap,
  portions: number,
): { needs: StockNeed[]; issues: CostIssue[] } {
  const r = costRecipe(recipe, ingredients);
  const scale = r.portions > 0 ? portions / r.portions : 0;
  const needs: StockNeed[] = [];
  for (const l of r.lines) {
    if (l.rawStockQty === null) continue;
    // Not rounded here: a per-portion figure like 0.0004 kg must survive until the sale total is rounded.
    needs.push({ ingredientId: l.ingredientId, rawStockQty: l.rawStockQty * scale });
  }
  return { needs, issues: r.issues };
}
