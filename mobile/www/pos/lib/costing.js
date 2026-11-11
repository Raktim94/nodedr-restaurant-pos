// GENERATED from packages/types/src/costing.ts by scripts/gen-mobile-costing.mjs - do not edit by hand.
// The phone runs the same recipe-costing code as the server, so figures match offline.
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
// factor = how many of the dimension's base unit (g / ml / piece) one unit is.
const UNITS = {
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
export const COST_UNITS = Object.keys(UNITS);
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const sameDim = (a, b) => UNITS[a].dim === UNITS[b].dim;
const direct = (q, from, to) => (q * UNITS[from].factor) / UNITS[to].factor;
/**
 * Converts a quantity between units. Same-dimension units (kg/g, l/ml,
 * piece/dozen) convert freely. Weight <-> volume <-> count only converts
 * through an ingredient-specific conversion (stockUnit + conversions); with
 * none it returns null - it never guesses a density.
 */
export function convertQty(qty, from, to, stockUnit, conversions = []) {
    if (!Number.isFinite(qty))
        return null;
    if (sameDim(from, to))
        return direct(qty, from, to);
    if (!stockUnit)
        return null;
    // Step 1: express the quantity in the ingredient's stock unit.
    let inStock = null;
    if (sameDim(from, stockUnit))
        inStock = direct(qty, from, stockUnit);
    else {
        const c = conversions.find((x) => sameDim(x.unit, from) && x.per > 0);
        if (c)
            inStock = direct(qty, from, c.unit) / c.per;
    }
    if (inStock === null)
        return null;
    // Step 2: stock unit -> target.
    if (sameDim(stockUnit, to))
        return direct(inStock, stockUnit, to);
    const c = conversions.find((x) => sameDim(x.unit, to) && x.per > 0);
    if (!c)
        return null;
    return direct(inStock * c.per, c.unit, to);
}
const validYield = (y) => Number.isFinite(y) && y > 0 && y <= 100;
/** Cost of the ingredient's *purchase* quantity expressed per stock unit, or null. */
function manualPerStockUnit(ing) {
    const q = ing.purchaseQuantity ?? 0;
    const price = ing.purchasePrice;
    const pu = ing.purchaseUnit ?? ing.unit;
    if (price == null || !(price >= 0) || !(q > 0))
        return null;
    const inStock = convertQty(q, pu, ing.unit, ing.unit, ing.conversions ?? []);
    if (inStock === null || !(inStock > 0))
        return null;
    return price / inStock;
}
/**
 * The effective unit cost of an ingredient and which method produced it.
 * AVERAGE reuses the inventory valuation (weighted average kept by goods
 * receipts); with no purchase history yet it falls back to the manual
 * purchase cost and says so. RECIPE (prepared items) prices from the
 * preparation's own recipe, recursively, with cycle detection.
 */
export function effectiveUnitCost(ing, ingredients, issues = [], trail = []) {
    const y = ing.yieldPercent;
    if (!validYield(y)) {
        issues.push({ code: "INVALID_YIELD", ingredientId: ing.id, message: `${ing.name}: usable yield must be above 0% and at most 100%` });
        return { rawPerStockUnit: null, usablePerStockUnit: null, source: "MISSING", yieldPercent: y, label: "Invalid yield" };
    }
    const finish = (raw, source, label) => ({
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
        for (const i of r.issues)
            issues.push(i);
        if (r.costPerPortion === null)
            return finish(null, "MISSING", "Recipe cost incomplete");
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
    if (ing.costPerUnit > 0)
        return finish(ing.costPerUnit, "AVERAGE", "Weighted average of purchases");
    const m = manualPerStockUnit(ing);
    if (m !== null)
        return finish(m, "MANUAL_FALLBACK", "Manual cost (no purchases received yet)");
    issues.push({ code: "MISSING_PRICE", ingredientId: ing.id, message: `${ing.name} has no purchase price` });
    return finish(null, "MISSING", "No price set");
}
/**
 * Costs one recipe batch. `portions` (batchOutputQty) divides the batch cost;
 * per-batch overheads are spread over it, per-portion overheads are added once
 * per portion. A line that cannot be priced is listed with its issue and the
 * result is marked incomplete (cost per portion is null rather than a figure
 * that silently understates the real cost).
 */
export function costRecipe(recipe, ingredients, opts = {}) {
    const trail = opts.trail ?? [];
    const issues = [];
    const lines = [];
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
        const unit = (l.unit ?? ing.unit);
        const bad = (code, message) => {
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
            lines.push(bad("INCOMPATIBLE_UNIT", `${ing.name}: cannot convert ${unit.toLowerCase()} to ${ing.unit.toLowerCase()} - set a conversion on the ingredient`));
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
    const overheadBreakdown = [];
    let overheadCost = 0;
    for (const o of recipe.overheads ?? []) {
        if (!Number.isFinite(o.amount) || o.amount < 0)
            continue;
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
export function productionCost(costPerPortion, portions) {
    if (costPerPortion === null || !Number.isFinite(portions) || portions < 0)
        return null;
    return round2(costPerPortion * portions);
}
/** Revenue excluding sales tax for a listed price, honouring the branch's tax mode. */
export function netRevenue(listedPrice, taxRatePercent, taxMode) {
    if (taxMode === "INCLUSIVE" && taxRatePercent > 0)
        return listedPrice / (1 + taxRatePercent / 100);
    return listedPrice;
}
/** The price a customer sees for a given ex-tax price. */
export function listedFromNet(netPrice, taxRatePercent, taxMode) {
    if (taxMode === "INCLUSIVE" && taxRatePercent > 0)
        return netPrice * (1 + taxRatePercent / 100);
    return netPrice;
}
/** Margin price = cost / (1 - margin%). Invalid (null) for margin outside [0, 100). */
export function marginPrice(cost, marginPercent) {
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(marginPercent))
        return null;
    if (marginPercent < 0 || marginPercent >= 100)
        return null;
    return (cost * 100) / (100 - marginPercent);
}
/** Markup price = cost * (1 + markup%). Invalid (null) for negative markup. */
export function markupPrice(cost, markupPercent) {
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(markupPercent) || markupPercent < 0)
        return null;
    return (cost * (100 + markupPercent)) / 100;
}
export function profitability(args) {
    const net = netRevenue(args.listedPrice, args.taxRatePercent, args.taxMode);
    const listedWithTax = args.taxMode === "EXCLUSIVE" ? listedFromNet(args.listedPrice, args.taxRatePercent, "INCLUSIVE") : args.listedPrice;
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
export function suggestPrice(args) {
    if (args.cost === null)
        return null;
    const net = args.method === "MARGIN" ? marginPrice(args.cost, args.percent) : markupPrice(args.cost, args.percent);
    if (net === null)
        return null;
    return {
        method: args.method,
        percent: args.percent,
        priceBeforeTax: round2(net),
        listedPrice: round2(listedFromNet(net, args.taxRatePercent, args.taxMode)),
    };
}
/**
 * Compares today's cost with the cost when the price was last reviewed.
 * WATCH when the margin fell by at least `thresholdPoints` or sits under the
 * target; LOSS when the dish now sells below cost.
 */
export function marginAlert(args) {
    const { baselineCost, currentCost, netRevenue: rev } = args;
    if (currentCost === null || !(rev > 0)) {
        return { level: "UNKNOWN", baselineMarginPercent: null, currentMarginPercent: null, dropPoints: null, belowTarget: false, message: "Cost is not fully priced yet" };
    }
    const cur = ((rev - currentCost) / rev) * 100;
    const base = baselineCost === null ? null : ((rev - baselineCost) / rev) * 100;
    const drop = base === null ? null : base - cur;
    const belowTarget = args.targetMarginPercent != null && cur < args.targetMarginPercent;
    let level = "OK";
    let message = "Margin is healthy";
    if (cur < 0) {
        level = "LOSS";
        message = "Selling below cost";
    }
    else if (drop !== null && drop >= args.thresholdPoints) {
        level = "WATCH";
        message = `Margin fell ${round2(drop)} points since the price was last reviewed`;
    }
    else if (belowTarget) {
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
export function wouldCreateCycle(preparationOutputId, candidateIngredientIds, usesOf) {
    const seen = new Set();
    const stack = [...candidateIngredientIds];
    while (stack.length) {
        const id = stack.pop();
        if (id === preparationOutputId)
            return true;
        if (seen.has(id))
            continue;
        seen.add(id);
        for (const next of usesOf(id))
            stack.push(next);
    }
    return false;
}
/** Cost and raw-stock effect of one option; negative lines subtract (a removal saves money and stock). */
export function costModifierLines(lines, ingredients) {
    const out = [];
    const issues = [];
    let cost = 0;
    let complete = true;
    for (const l of lines) {
        const sign = l.quantity < 0 ? -1 : 1;
        const r = costRecipe({ lines: [{ ingredientId: l.ingredientId, quantity: Math.abs(l.quantity), unit: l.unit }], batchOutputQty: 1 }, ingredients);
        for (const i of r.issues)
            issues.push(i);
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
export function unitCostOfSale(args) {
    if (args.costPerPortion === null)
        return null;
    let total = args.costPerPortion * args.portionRatio;
    for (const m of args.modifierCosts) {
        if (m === null)
            return null;
        total += m;
    }
    return round4(Math.max(0, total));
}
/**
 * Raw ingredient stock used to make `portions` portions from a recipe batch:
 * every line's raw (yield-adjusted) quantity, scaled by portions / batch output.
 * Lines that cannot be converted are skipped here and reported via issues.
 */
export function stockNeedsForPortions(recipe, ingredients, portions) {
    const r = costRecipe(recipe, ingredients);
    const scale = r.portions > 0 ? portions / r.portions : 0;
    const needs = [];
    for (const l of r.lines) {
        if (l.rawStockQty === null)
            continue;
        // Not rounded here: a per-portion figure like 0.0004 kg must survive until the sale total is rounded.
        needs.push({ ingredientId: l.ingredientId, rawStockQty: l.rawStockQty * scale });
    }
    return { needs, issues: r.issues };
}
