import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledge, analyseDish, cleanIngredient, conflicts, emptyBook, mergeServer, payloadFor, pendingRecipes, removeIngredient, resolveConflict, saveIngredient, saveRecipe } from './costbook.js';

const flour = { name: 'Flour', unit: 'KG', purchaseQuantity: 1, purchaseUnit: 'KG', purchasePrice: 50 };
const dish = { id: 'd1', name: 'Pasta', price: 100, taxRate: 0 };
const withFlour = () => saveIngredient(emptyBook(), flour, undefined, 'local-1');

test('flour at 50/kg, 200 g in the recipe costs 10 - offline, no server involved', () => {
  const b = saveRecipe(withFlour(), 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'local-1', quantity: 200, unit: 'G' }] });
  const a = analyseDish(b, dish);
  assert.equal(a.cost.ingredientCost, 10);
  assert.equal(a.cost.costPerPortion, 10);
  assert.equal(a.profit.grossMarginPercent, 90);
});

test('a 600 batch of 20 portions is 30 each; 60% margin suggests 75 and 60% markup 48', () => {
  let b = saveIngredient(emptyBook(), { name: 'Rice', unit: 'KG', purchaseQuantity: 1, purchaseUnit: 'KG', purchasePrice: 100, yieldPercent: 80 }, undefined, 'r');
  b = saveRecipe(b, 'd1', { batchOutputQty: 20, targetMarginPercent: 60, targetMarkupPercent: 60, lines: [{ ingredientId: 'r', quantity: 4.8, unit: 'KG' }] });
  const a = analyseDish(b, dish);
  assert.equal(a.cost.batchCost, 600);
  assert.equal(a.cost.costPerPortion, 30);
  assert.equal(a.margin.priceBeforeTax, 75);
  assert.equal(a.markup.priceBeforeTax, 48);
});

test('tax: 105 incl. 5% tax with cost 30 is a 70% margin on 100', () => {
  let b = saveIngredient(emptyBook(), { name: 'X', unit: 'KG', purchaseQuantity: 1, purchaseUnit: 'KG', purchasePrice: 50 }, undefined, 'x');
  b = saveRecipe(b, 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'x', quantity: 600, unit: 'G' }] });
  const a = analyseDish(b, { ...dish, price: 105, taxRate: 5 });
  assert.equal(a.profit.netRevenue, 100);
  assert.equal(a.profit.grossMarginPercent, 70);
});

test('save, close and reopen: the recipe survives a JSON round trip (IndexedDB)', () => {
  const b = saveRecipe(withFlour(), 'd1', { batchOutputQty: 4, overheads: [{ kind: 'PACKAGING', amount: 2, basis: 'PER_PORTION' }], lines: [{ ingredientId: 'local-1', quantity: 400, unit: 'G' }] });
  const reopened = JSON.parse(JSON.stringify(b));
  assert.deepEqual(analyseDish(reopened, dish).cost.costPerPortion, analyseDish(b, dish).cost.costPerPortion);
  assert.equal(analyseDish(reopened, dish).cost.costPerPortion, 7); // 20/4 + 2
});

test('rejects bad input with plain messages', () => {
  assert.throws(() => cleanIngredient({ name: '', unit: 'KG' }), /name/);
  assert.throws(() => cleanIngredient({ name: 'a', unit: 'KG', purchaseQuantity: 1 }), /both/);
  assert.throws(() => cleanIngredient({ name: 'a', unit: 'KG', yieldPercent: 0 }), /yield/);
  assert.throws(() => cleanIngredient({ name: 'a', unit: 'PIECE', purchaseQuantity: 1, purchaseUnit: 'KG', purchasePrice: 5 }), /bridge/);
  assert.throws(() => saveRecipe(withFlour(), 'd1', { batchOutputQty: 0, lines: [{ ingredientId: 'local-1', quantity: 1 }] }), /Portions/);
  assert.throws(() => saveRecipe(withFlour(), 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'local-1', quantity: -1 }] }), /above zero/);
  assert.throws(() => saveRecipe(withFlour(), 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'local-1', quantity: 1 }, { ingredientId: 'local-1', quantity: 2 }] }), /twice/);
  assert.throws(() => saveRecipe(withFlour(), 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'local-1', quantity: 1, unit: 'L' }] }), /convert/);
  assert.throws(() => saveIngredient(withFlour(), flour, undefined, 'dup'), /already/);
});

test('an ingredient in use cannot be removed', () => {
  const b = saveRecipe(withFlour(), 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'local-1', quantity: 1 }] });
  assert.throws(() => removeIngredient(b, 'local-1'), /still uses/);
});

test('an unpriced ingredient gives no cost instead of a wrong one', () => {
  let b = saveIngredient(emptyBook(), { name: 'Mystery', unit: 'KG' }, undefined, 'm');
  b = saveRecipe(b, 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'm', quantity: 1 }] });
  const a = analyseDish(b, dish);
  assert.equal(a.cost.costPerPortion, null);
  assert.equal(a.profit, null);
  assert.equal(a.margin, null);
});

test('margin warning appears when a price rises, and clears once acknowledged', () => {
  let b = saveRecipe(withFlour(), 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 'local-1', quantity: 200, unit: 'G' }] });
  assert.equal(analyseDish(b, dish).alert.level, 'OK');
  b = saveIngredient(b, { ...flour, purchasePrice: 80 }, 'local-1');
  assert.equal(analyseDish(b, dish).alert.level, 'WATCH');
  b = acknowledge(b, 'd1', dish);
  assert.equal(analyseDish(b, dish).alert.level, 'OK');
});

const bundle = (version, qty = 200) => ({
  taxMode: 'INCLUSIVE',
  ingredients: [{ id: 's-flour', name: 'Flour', unit: 'KG', costMethod: 'MANUAL', costPerUnit: 0, purchaseQuantity: 1, purchaseUnit: 'KG', purchasePrice: 50, yieldPercent: 100, conversions: [], version: 1 }],
  items: [{ menuItemId: 'd1', lines: [{ ingredientId: 's-flour', quantity: qty, unit: 'G' }], batchOutputQty: 1, overheads: [], halfPortionRatio: 0.5, targetMarginPercent: null, targetMarkupPercent: null, alertDropPoints: 5, baselineCost: 10, version }],
  modifiers: [],
});

test('server sync: an offline edit is sent with its base version; no edit means the server copy wins', () => {
  let b = mergeServer(emptyBook(), bundle(3));
  assert.equal(analyseDish(b, dish).cost.costPerPortion, 10);
  b = saveRecipe(b, 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 's-flour', quantity: 300, unit: 'G' }] });
  assert.deepEqual(pendingRecipes(b), ['d1']);
  assert.equal(payloadFor(b.recipes.d1).baseVersion, 3);
  b = mergeServer(b, bundle(3)); // unchanged server: the edit stays queued
  assert.deepEqual(pendingRecipes(b), ['d1']);
  assert.equal(analyseDish(b, dish).cost.costPerPortion, 15);
});

test('server sync: if the server moved while the phone was offline it is a conflict, never overwritten', () => {
  let b = mergeServer(emptyBook(), bundle(3));
  b = saveRecipe(b, 'd1', { batchOutputQty: 1, lines: [{ ingredientId: 's-flour', quantity: 300, unit: 'G' }] });
  b = mergeServer(b, bundle(4, 250));
  assert.deepEqual(conflicts(b), ['d1']);
  assert.deepEqual(pendingRecipes(b), []); // held back, not sent
  const keepServer = resolveConflict(b, 'd1', 'server');
  assert.equal(analyseDish(keepServer, dish).cost.costPerPortion, 12.5);
  assert.deepEqual(pendingRecipes(keepServer), []);
  const keepMine = resolveConflict(b, 'd1', 'mine');
  assert.equal(payloadFor(keepMine.recipes.d1).baseVersion, 4); // now builds on the server's latest
  assert.deepEqual(pendingRecipes(keepMine), ['d1']);
});
