// The phone's cost book: ingredients and recipes kept in IndexedDB, costed with the SAME engine the
// server uses (costing.js, generated from packages/types), so figures match with no connection.
// Pure functions over a plain object; pos.js stores the object under kv 'costbook'.
//
// Phone-account (local) mode: ingredients and recipes are edited here, and a suggested price can be
// applied to the phone's own menu. Server mode: the phone keeps a copy of the server's ingredients
// (read-only here), recipes can be edited offline and are sent when back online; if the server's copy
// moved meanwhile the edit is held as a CONFLICT for the owner to settle - never silently overwritten.
import { convertQty, costRecipe, marginAlert, profitability, suggestPrice } from './costing.js';

export const UNITS = ['KG', 'G', 'L', 'ML', 'PIECE', 'DOZEN', 'PACK', 'BOX'];

export const emptyBook = (taxMode = 'INCLUSIVE') => ({ ingredients: [], recipes: {}, taxMode, fetchedAt: null });

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const clone = (o) => JSON.parse(JSON.stringify(o));

export function ingredientMap(book) {
  return new Map(
    book.ingredients.map((i) => [
      i.id,
      {
        id: i.id,
        name: i.name,
        unit: i.unit,
        costPerUnit: Number(i.costPerUnit) || 0,
        costMethod: i.costMethod || 'MANUAL',
        purchaseQuantity: i.purchaseQuantity == null ? null : Number(i.purchaseQuantity),
        purchaseUnit: i.purchaseUnit || null,
        purchasePrice: i.purchasePrice == null ? null : Number(i.purchasePrice),
        yieldPercent: i.yieldPercent == null ? 100 : Number(i.yieldPercent),
        conversions: i.conversions || [],
        preparation: i.preparation || null,
      },
    ]),
  );
}

/** Checks one ingredient form; returns the cleaned record or throws a message a cook can act on. */
export function cleanIngredient(f) {
  const name = String(f.name || '').trim();
  if (!name) throw new Error('Give the ingredient a name.');
  if (!UNITS.includes(f.unit)) throw new Error('Pick a unit.');
  const qty = num(f.purchaseQuantity);
  const price = num(f.purchasePrice);
  if (Number.isNaN(qty) !== Number.isNaN(price)) throw new Error('Enter both what you bought and what it cost, or neither.');
  const yieldPercent = f.yieldPercent === '' || f.yieldPercent == null ? 100 : num(f.yieldPercent);
  if (!(yieldPercent > 0 && yieldPercent <= 100)) throw new Error('Usable yield must be above 0% and at most 100%.');
  const purchaseUnit = f.purchaseUnit || f.unit;
  const conversions = (f.conversions || []).filter((c) => num(c.per) > 0).map((c) => ({ unit: c.unit, per: Number(c.per) }));
  if (!Number.isNaN(qty)) {
    if (!(qty > 0)) throw new Error('Quantity bought must be above zero.');
    if (price < 0) throw new Error('Price cannot be negative.');
    if (convertQty(qty, purchaseUnit, f.unit, f.unit, conversions) === null) {
      throw new Error(`Cannot turn ${purchaseUnit.toLowerCase()} into ${f.unit.toLowerCase()} - add a unit bridge, e.g. 1 ${f.unit.toLowerCase()} = 920 g.`);
    }
  }
  return {
    name,
    unit: f.unit,
    costMethod: 'MANUAL',
    purchaseQuantity: Number.isNaN(qty) ? null : qty,
    purchaseUnit: Number.isNaN(qty) ? null : purchaseUnit,
    purchasePrice: Number.isNaN(price) ? null : price,
    yieldPercent,
    conversions,
  };
}

export function saveIngredient(book, f, id, newId) {
  const rec = cleanIngredient(f);
  const next = clone(book);
  if (next.ingredients.some((i) => i.id !== id && i.name.toLowerCase() === rec.name.toLowerCase())) {
    throw new Error(`You already have an ingredient called ${rec.name}.`);
  }
  const at = next.ingredients.findIndex((i) => i.id === id);
  if (at >= 0) next.ingredients[at] = { ...next.ingredients[at], ...rec };
  else next.ingredients.push({ id: newId, ...rec, costPerUnit: 0, version: 1, local: true });
  next.ingredients.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

export function removeIngredient(book, id) {
  const used = Object.entries(book.recipes).find(([, r]) => r.lines.some((l) => l.ingredientId === id));
  if (used) throw new Error('A recipe still uses it. Remove it from the recipe first.');
  const next = clone(book);
  next.ingredients = next.ingredients.filter((i) => i.id !== id);
  return next;
}

const toEngine = (r) => ({
  lines: r.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit || null })),
  batchOutputQty: Number(r.batchOutputQty),
  overheads: (r.overheads || []).map((o) => ({ kind: o.kind, amount: Number(o.amount), basis: o.basis })),
});

/** Cost, profit and price ideas for a dish, from its saved recipe. */
export function analyseDish(book, dish, recipe) {
  const map = ingredientMap(book);
  const r = recipe || book.recipes[dish.id];
  if (!r || r.lines.length === 0) return { hasRecipe: false };
  const cost = costRecipe(toEngine(r), map);
  const tax = Number(dish.taxRate ?? dish.taxRatePercent ?? 0);
  const prof = cost.costPerPortion === null ? null : profitability({ cost: cost.costPerPortion, listedPrice: Number(dish.price), taxRatePercent: tax, taxMode: book.taxMode });
  const sug = (method, pct) =>
    cost.costPerPortion === null || !Number.isFinite(Number(pct)) ? null : suggestPrice({ cost: cost.costPerPortion, method, percent: Number(pct), taxRatePercent: tax, taxMode: book.taxMode });
  const alert =
    prof && r.baselineCost != null
      ? marginAlert({ baselineCost: r.baselineCost, currentCost: cost.costPerPortion, netRevenue: prof.netRevenue, thresholdPoints: r.alertDropPoints ?? 5, targetMarginPercent: r.targetMarginPercent ?? null })
      : null;
  return { hasRecipe: true, cost, profit: prof, margin: sug('MARGIN', r.targetMarginPercent), markup: sug('MARKUP', r.targetMarkupPercent), sug, alert };
}

/** Validates and stores a dish recipe on the phone, flagged to be sent when a server is connected. */
export function saveRecipe(book, dishId, f) {
  const lines = (f.lines || []).filter((l) => l.ingredientId);
  const ids = lines.map((l) => l.ingredientId);
  if (new Set(ids).size !== ids.length) throw new Error('An ingredient is listed twice. Combine the lines.');
  for (const l of lines) if (!(num(l.quantity) > 0)) throw new Error('Every ingredient needs a quantity above zero.');
  if (!(num(f.batchOutputQty) > 0)) throw new Error('Portions per batch must be above zero.');
  const cleaned = {
    lines: lines.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unit: l.unit || null })),
    batchOutputQty: Number(f.batchOutputQty),
    overheads: (f.overheads || []).filter((o) => num(o.amount) > 0).map((o) => ({ kind: o.kind, amount: Number(o.amount), basis: o.basis })),
    halfPortionRatio: num(f.halfPortionRatio) > 0 ? Number(f.halfPortionRatio) : 0.5,
    targetMarginPercent: Number.isFinite(num(f.targetMarginPercent)) ? Number(f.targetMarginPercent) : null,
    targetMarkupPercent: Number.isFinite(num(f.targetMarkupPercent)) ? Number(f.targetMarkupPercent) : null,
    alertDropPoints: num(f.alertDropPoints) >= 0 ? Number(f.alertDropPoints) : 5,
  };
  const probe = costRecipe(toEngine(cleaned), ingredientMap(book));
  const hard = probe.issues.find((i) => i.code === 'INCOMPATIBLE_UNIT' || i.code === 'UNKNOWN_INGREDIENT');
  if (hard) throw new Error(hard.message);
  const next = clone(book);
  const prev = next.recipes[dishId] || {};
  next.recipes[dishId] = {
    ...prev,
    ...cleaned,
    version: prev.version || 0, // the server version this edit started from (its "base")
    baselineCost: prev.baselineCost ?? probe.costPerPortion,
    dirty: true,
    conflict: false,
    error: null,
  };
  return next;
}

/** Said "the price is fine": today's cost becomes the new baseline for margin warnings. */
export function acknowledge(book, dishId, dish) {
  const a = analyseDish(book, dish);
  if (!a.hasRecipe || a.cost.costPerPortion === null) throw new Error('The cost is not fully priced yet.');
  const next = clone(book);
  next.recipes[dishId].baselineCost = a.cost.costPerPortion;
  return next;
}

export const pendingRecipes = (book) => Object.entries(book.recipes).filter(([, r]) => r.dirty && !r.conflict).map(([id]) => id);
export const conflicts = (book) => Object.entries(book.recipes).filter(([, r]) => r.conflict).map(([id]) => id);

/**
 * Takes the server's bundle. Server ingredients and unedited recipes replace the phone's copy.
 * A recipe edited on the phone is kept: if the server's version still equals the edit's base it is
 * simply sent later, otherwise it becomes a conflict holding both copies.
 */
export function mergeServer(book, bundle) {
  const next = clone(book);
  next.taxMode = bundle.taxMode;
  next.fetchedAt = Date.now();
  next.ingredients = bundle.ingredients.map((i) => ({ ...i }));
  for (const it of bundle.items) {
    const server = {
      lines: it.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, unit: l.unit || null })),
      batchOutputQty: it.batchOutputQty,
      overheads: it.overheads,
      halfPortionRatio: it.halfPortionRatio,
      targetMarginPercent: it.targetMarginPercent,
      targetMarkupPercent: it.targetMarkupPercent,
      alertDropPoints: it.alertDropPoints,
      baselineCost: it.baselineCost,
      version: it.version,
    };
    const mine = next.recipes[it.menuItemId];
    if (!mine || !mine.dirty) {
      next.recipes[it.menuItemId] = server;
    } else if (mine.version !== it.version) {
      next.recipes[it.menuItemId] = { ...mine, conflict: true, server };
    }
  }
  return next;
}

/** Settle a conflict: keep the phone's edit (it is then sent on top of the server's version) or take the server's. */
export function resolveConflict(book, dishId, keep) {
  const next = clone(book);
  const r = next.recipes[dishId];
  if (!r || !r.conflict) return next;
  if (keep === 'server') next.recipes[dishId] = r.server;
  else next.recipes[dishId] = { ...r, version: r.server.version, conflict: false, dirty: true, server: undefined };
  return next;
}

export const payloadFor = (r) => ({
  lines: r.lines,
  batchOutputQty: r.batchOutputQty,
  overheads: r.overheads || [],
  halfPortionRatio: r.halfPortionRatio ?? 0.5,
  targetMarginPercent: r.targetMarginPercent ?? null,
  targetMarkupPercent: r.targetMarkupPercent ?? null,
  alertDropPoints: r.alertDropPoints ?? 5,
  baseVersion: r.version || 0,
});
