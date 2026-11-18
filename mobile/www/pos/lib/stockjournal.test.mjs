import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_RECIPES_FOR_PRODUCT, capsFrom, createInventoryItem, createMenuItem, deleteDraft, emptyForm, fillFromRecipe, formFromDraft, formProblem, friendlyError,
  loadCosting, loadRecipes, postDraft, postNew, recipeProblem, recipeState, saveDraft, saveRecipe, shortRows, unitProblem, voucherBody,
} from './stockjournal.js';

const flour = { id: 'f', name: 'Flour', unit: 'KG', kind: 'PURCHASED', units: ['KG', 'G'], currentStock: '10' };
const bread = { id: 'b', name: 'Bread', unit: 'PIECE', kind: 'PREPARED', units: ['PIECE', 'DOZEN'], currentStock: '0' };
const items = [flour, bread];
const form = (over = {}) => ({ ...emptyForm(), productId: 'b', madeQty: '20', madeUnit: 'PIECE', rows: [{ ingredientId: 'f', quantity: '2', unit: 'KG', expected: '' }], ...over });
const sendOf = (answers) => { const calls = []; const send = async (method, path, body) => { calls.push({ method, path, body }); const a = answers.shift(); if (a instanceof Error) throw a; return a; }; send.calls = calls; return send; };

test('the empty wording is exactly the agreed sentence', () => assert.equal(NO_RECIPES_FOR_PRODUCT, 'No saved recipes for this product yet'));

test('"empty" only for a loaded, genuinely empty result for the chosen product', () => {
  assert.equal(recipeState({ hasProduct: false, loaded: true, count: 0 }), 'choose-product');
  assert.equal(recipeState({ hasProduct: true, loading: true }), 'loading');
  assert.equal(recipeState({ hasProduct: true, error: true }), 'error');
  assert.equal(recipeState({ hasProduct: true, online: false, loaded: false }), 'offline');
  assert.equal(recipeState({ hasProduct: true, loaded: true, count: 0 }), 'empty');
  assert.equal(recipeState({ hasProduct: true, loaded: true, count: 3 }), 'ready');
});

test('loadRecipes: a failure or no connection is never reported as empty', async () => {
  assert.equal((await loadRecipes(sendOf([{ status: 200, data: [] }]), 'br', 'b')).state, 'empty');
  assert.equal((await loadRecipes(sendOf([{ status: 200, data: [{ id: 'r' }] }]), 'br', 'b')).state, 'ready');
  assert.equal((await loadRecipes(sendOf([{ status: 500, data: {} }]), 'br', 'b')).state, 'error');
  assert.equal((await loadRecipes(sendOf([{ status: 403, data: { message: 'no' } }]), 'br', 'b')).state, 'error');
  assert.equal((await loadRecipes(sendOf([{ status: 0, data: null }]), 'br', 'b')).state, 'offline');
  assert.equal((await loadRecipes(sendOf([new Error('net')]), 'br', 'b')).state, 'offline');
});

test('loadRecipes asks for the chosen product only', async () => {
  const s = sendOf([{ status: 200, data: [] }]);
  await loadRecipes(s, 'br 1', 'prod/1');
  assert.equal(s.calls[0].path, '/api/v1/inventory/recipes?branchId=br%201&productId=prod%2F1');
});

test('buttons follow what the account may do; an old server offers nothing that needs new routes', () => {
  assert.deepEqual(capsFrom({ stockItems: [], stockCaps: { record: true, post: false, recipes: true } }).post, false);
  assert.equal(capsFrom({ stockItems: [], stockCaps: { record: true, post: true, recipes: true, menuItems: false } }).menuItems, false);
  const old = capsFrom({ stockItems: [] });
  assert.equal(old.post, true);
  assert.equal(old.recipes, false);
  assert.equal(old.inventoryItems, false);
  assert.equal(capsFrom({}).record, false);
});

test('form problems are said in words', () => {
  assert.match(formProblem(form({ productId: '' }), items), /Choose the product/);
  assert.match(formProblem(form({ madeQty: '' }), items), /good quantity/);
  assert.match(formProblem(form({ madeQty: '-1' }), items), /good quantity/);
  assert.match(formProblem(form({ rows: [{ ingredientId: '', quantity: '', unit: '' }] }), items), /at least one ingredient/);
  assert.match(formProblem(form({ rows: [{ ingredientId: 'f', quantity: '0', unit: 'KG' }] }), items), /above zero/);
  assert.match(formProblem(form({ rows: [{ ingredientId: 'b', quantity: '1', unit: 'PIECE' }] }), items), /cannot also be an ingredient/);
  assert.match(formProblem(form({ rows: [{ ingredientId: 'f', quantity: '1', unit: 'KG' }, { ingredientId: 'f', quantity: '1', unit: 'KG' }] }), items), /only once/);
  assert.equal(formProblem(form(), items), null);
});

test('an incompatible unit gets a readable sentence naming the allowed units', () => {
  assert.equal(unitProblem(flour, 'G'), null);
  assert.match(formProblem(form({ rows: [{ ingredientId: 'f', quantity: '1', unit: 'L' }] }), items), /Flour is stocked in KG, so it cannot be entered in L\. Choose KG, G/);
});

test('shortage is only a hint, and only for same-unit rows with a known stock', () => {
  assert.equal(shortRows(form({ rows: [{ ingredientId: 'f', quantity: '11', unit: 'KG' }] }), items).length, 1);
  assert.equal(shortRows(form({ rows: [{ ingredientId: 'f', quantity: '11000', unit: 'G' }] }), items).length, 0); // other unit: the server converts and decides
  assert.equal(shortRows(form({ rows: [{ ingredientId: 'f', quantity: '11', unit: 'KG' }] }), [{ ...flour, currentStock: undefined }, bread]).length, 0);
});

test('voucherBody: draft flag, idempotency key, recipe reference, narration', () => {
  const b = voucherBody(form({ batchRef: ' B1 ', notes: 'n', shift: 'Morning', recipeKey: 'RECIPE:r1', rejected: '2' }), items, { post: false, key: 'phd-12345678' });
  assert.equal(b.post, false);
  assert.equal(b.idempotencyKey, 'phd-12345678');
  assert.equal(b.batchRef, 'B1');
  assert.deepEqual(b.recipe, { kind: 'RECIPE', id: 'r1' });
  assert.equal(b.outputs[0].rejectedQuantity, '2');
  assert.equal(b.inputs[0].unit, 'KG');
  assert.equal('recipe' in voucherBody(form(), items, { post: true }), false);
});

test('Save as recipe: needs a product, a quantity, every ingredient and a name; sends a template with no stock fields', async () => {
  assert.match(recipeProblem(form({ productId: '' }), items, 'x'), /product/);
  assert.match(recipeProblem(form({ madeQty: '' }), items, 'x'), /quantity/);
  assert.match(recipeProblem(form(), items, ' '), /name/);
  const s = sendOf([{ status: 201, data: { id: 'r9', kind: 'RECIPE', name: 'Bread basic' } }]);
  const r = await saveRecipe(s, 'br', form(), items, 'Bread basic');
  assert.equal(r.ok, true);
  assert.equal(s.calls[0].path, '/api/v1/inventory/recipes?branchId=br');
  assert.deepEqual(s.calls[0].body, { outputIngredientId: 'b', name: 'Bread basic', baseOutputQty: '20', lines: [{ ingredientId: 'f', quantity: '2', unit: 'KG' }] });
});

test('Save as recipe failure: a clear error comes back and nothing about the form is lost', async () => {
  const F = form();
  const snapshot = JSON.stringify(F);
  const r = await saveRecipe(sendOf([{ status: 403, data: { message: 'Forbidden' } }]), 'br', F, items, 'Bread basic');
  assert.equal(r.ok, false);
  assert.match(r.error, /not allowed/);
  assert.equal(JSON.stringify(F), snapshot);
  assert.equal((await saveRecipe(sendOf([{ status: 0, data: null }]), 'br', F, items, 'x')).error.includes('Your entries are still here'), true);
});

test('Fill from recipe: scaled by the server to the planned quantity; rows carry the expected figure and stay editable', async () => {
  const s = sendOf([{ status: 200, data: { recipe: { name: 'Bread basic', version: 1 }, plannedOutput: '20', lines: [{ ingredientId: 'f', quantity: '2', unit: 'KG', name: 'Flour', stockUnit: 'KG' }] } }]);
  const r = await fillFromRecipe(s, 'br', form({ recipeKey: 'RECIPE:r1' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [{ ingredientId: 'f', quantity: '2', unit: 'KG', expected: '2' }]);
  assert.match(s.calls[0].path, /recipes\/fill\?branchId=br&kind=RECIPE&id=r1&quantity=20/);
  assert.match((await fillFromRecipe(sendOf([]), 'br', form({ recipeKey: '' }))).error, /Choose which recipe/);
  assert.match((await fillFromRecipe(sendOf([]), 'br', form({ recipeKey: 'RECIPE:r1', madeQty: '' }))).error, /planned good quantity/);
});

test('Save draft: POST once with its own key (post=false); editing a draft PATCHes the same entry', async () => {
  const F = form();
  const s = sendOf([{ status: 201, data: { id: 'd1', entryNo: 'PR-1' } }, { status: 201, data: { id: 'd1', entryNo: 'PR-1' } }]);
  const a = await saveDraft(s, 'br', F, items);
  const b = await saveDraft(s, 'br', F, items);
  assert.equal(a.ok, true);
  assert.equal(s.calls[0].body.post, false);
  assert.equal(s.calls[0].body.idempotencyKey, s.calls[1].body.idempotencyKey); // a retry of the same form reuses its key
  const d = formFromDraft({ id: 'd1', entryNo: 'PR-1', shift: 'Morning', batchRef: 'B', notes: 'n', lines: [{ role: 'OUTPUT', ingredientId: 'b', quantity: '30', rejectedQuantity: '0', ingredient: { unit: 'PIECE' } }, { role: 'INPUT', ingredientId: 'f', enteredQuantity: '3', enteredUnit: 'KG', expectedQuantity: '2.5' }] });
  assert.equal(d.productId, 'b');
  assert.equal(d.madeQty, '30');
  assert.deepEqual(d.rows[0], { ingredientId: 'f', quantity: '3', unit: 'KG', expected: '2.5' });
  const s2 = sendOf([{ status: 200, data: { id: 'd1', entryNo: 'PR-1' } }]);
  await saveDraft(s2, 'br', d, items);
  assert.equal(s2.calls[0].method, 'PATCH');
  assert.match(s2.calls[0].path, /production\/d1\?branchId=br/);
});

test('Save draft refuses an invalid form without calling the server', async () => {
  const s = sendOf([]);
  const r = await saveDraft(s, 'br', form({ madeQty: '' }), items);
  assert.equal(r.ok, false);
  assert.equal(s.calls.length, 0);
});

test('Post a draft: saves the edits, then posts; if posting fails the edits are kept and it says so', async () => {
  const F = { ...form(), draftId: 'd1', draftNo: 'PR-1' };
  const ok = sendOf([{ status: 200, data: { id: 'd1', entryNo: 'PR-1' } }, { status: 201, data: {} }]);
  assert.equal((await postDraft(ok, 'br', F, items)).ok, true);
  assert.deepEqual(ok.calls.map((c) => c.method), ['PATCH', 'POST']);
  const bad = sendOf([{ status: 200, data: { id: 'd1', entryNo: 'PR-1' } }, { status: 403, data: {} }]);
  const r = await postDraft(bad, 'br', F, items);
  assert.equal(r.ok, false);
  assert.equal(r.saved, true);
  assert.match(r.error, /saved to draft PR-1, but it was not posted/);
  const again = sendOf([{ status: 200, data: { id: 'd1', entryNo: 'PR-1' } }, { status: 409, data: {} }]);
  assert.match((await postDraft(again, 'br', F, items)).error, /already done/);
});

test('delete draft', async () => {
  assert.equal((await deleteDraft(sendOf([{ status: 200, data: { ok: true } }]), 'br', 'd1')).ok, true);
  assert.equal((await deleteDraft(sendOf([{ status: 400, data: { message: 'Only a draft can be deleted' } }]), 'br', 'd1')).ok, false);
});

test('Add inventory item creates a raw material only: one request, never a menu item', async () => {
  const s = sendOf([{ status: 201, data: { id: 'n1' } }]);
  const r = await createInventoryItem(s, 'br', { name: ' Salt ', unit: 'KG' });
  assert.deepEqual(r, { ok: true, id: 'n1' });
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].path, /inventory\/ingredients/);
  assert.equal(s.calls[0].body.kind, 'PURCHASED');
  assert.equal(s.calls[0].body.name, 'Salt');
  assert.equal((await createInventoryItem(sendOf([]), 'br', { name: ' ', unit: 'KG' })).ok, false);
});

test('a duplicate name is refused with the server\'s own words', async () => {
  const r = await createInventoryItem(sendOf([{ status: 409, data: { message: 'That name is already in use. Choose a different one.' } }]), 'br', { name: 'Salt', unit: 'KG' });
  assert.equal(r.ok, false);
  assert.ok(r.error.length > 10);
});

test('Add menu item: stock item, menu entry, link, in that order; validation first, nothing sent when invalid', async () => {
  assert.match((await createMenuItem(sendOf([]), 'br', { name: 'Roll', categoryId: '', price: '50', tax: '5' })).error, /category/);
  assert.match((await createMenuItem(sendOf([]), 'br', { name: 'Roll', categoryId: 'c', price: '', tax: '5' })).error, /selling price/);
  assert.match((await createMenuItem(sendOf([]), 'br', { name: 'Roll', categoryId: 'c', price: '50', tax: '' })).error, /tax rate/);
  const s = sendOf([{ status: 201, data: { id: 's1' } }, { status: 201, data: { id: 'm1' } }, { status: 200, data: {} }]);
  const r = await createMenuItem(s, 'br', { name: 'Roll', unit: 'PIECE', categoryId: 'c', price: '50', tax: '5' });
  assert.deepEqual(r, { ok: true, id: 's1' });
  assert.deepEqual(s.calls.map((c) => c.method + ' ' + c.path.split('?')[0]), ['POST /api/v1/inventory/ingredients', 'POST /api/v1/menu/items', 'PATCH /api/v1/inventory/menu-items/m1/tracking']);
  assert.equal(s.calls[0].body.kind, 'PREPARED');
});

test('Add menu item: if the menu step is refused the stock item still exists and the person is told', async () => {
  const r = await createMenuItem(sendOf([{ status: 201, data: { id: 's1' } }, { status: 403, data: {} }]), 'br', { name: 'Roll', unit: 'PIECE', categoryId: 'c', price: '50', tax: '5' });
  assert.equal(r.ok, true);
  assert.equal(r.id, 's1');
  assert.match(r.menuMissing, /not allowed/);
  assert.equal((await createMenuItem(sendOf([{ status: 409, data: { message: 'dup' } }]), 'br', { name: 'Roll', categoryId: 'c', price: '1', tax: '0' })).ok, false);
});

test('errors are readable: no connection, signed out, forbidden, already done, missing cost guidance', () => {
  assert.match(friendlyError({ status: 0 }), /still here/);
  assert.match(friendlyError({ status: 401 }), /Sign in again/);
  assert.match(friendlyError({ status: 403 }), /not allowed/);
  assert.match(friendlyError({ status: 409 }), /already done/);
  assert.equal(friendlyError({ status: 409, data: { message: 'That name is already in use. Choose a different one.' } }), 'That name is already in use. Choose a different one.');
  assert.match(friendlyError({ status: 500 }), /Nothing was changed/);
  const cost = friendlyError({ status: 400, data: { message: 'No cost yet for: Salt. Type a rate or receive it with a cost.' } });
  assert.match(cost, /No cost yet for: Salt/);
  assert.match(cost, /Purchase order/);
  assert.match(friendlyError({ status: 400, data: { issues: [{ message: 'Add at least one ingredient used' }] } }), /at least one ingredient/);
});

const deps = (statusAfter, error) => {
  const store = new Map();
  const log = [];
  return {
    log,
    queueEvent: async (kind, payload) => { const ev = { id: 'dev-abc12345', kind, payload, status: 'pending' }; store.set(ev.id, ev); log.push(['queue', payload]); return ev; },
    syncNow: async () => { const ev = store.get('dev-abc12345'); ev.status = statusAfter; if (error) ev.error = error; return { online: statusAfter !== 'pending' }; },
    getEvent: async (id) => store.get(id),
    dismissEvent: async (id) => { log.push(['dismiss', id]); store.get(id).status = 'dismissed'; return true; },
  };
};

test('Post: written on the phone first, sent at once, reported as posted', async () => {
  const d = deps('synced');
  const r = await postNew(d, form(), items, { userId: 'u', deviceId: 'phone-1234' });
  assert.equal(r.ok, true);
  assert.equal(r.posted, true);
  assert.equal(d.log[0][0], 'queue');
});

test('Post offline: kept on the phone to send later (still one record, so one posting)', async () => {
  const d = deps('pending');
  const r = await postNew(d, form(), items, { userId: 'u', deviceId: 'phone-1234' });
  assert.deepEqual([r.ok, r.posted, r.waiting], [true, false, true]);
  assert.equal(d.log.filter((l) => l[0] === 'queue').length, 1);
});

test('Post refused by the server (shortage / unit / cost): shown on the form, the form is untouched, the record is set aside', async () => {
  const F = form();
  const snap = JSON.stringify(F);
  const d = deps('failed', 'Not enough stock: Flour: only 10 KG in stock.');
  const r = await postNew(d, F, items, { userId: 'u', deviceId: 'phone-1234' });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.match(r.error, /Not enough stock/);
  assert.equal(JSON.stringify(F), snap);
  assert.ok(d.log.some((l) => l[0] === 'dismiss'));
});

test('Post with a missing cost shows the guidance', async () => {
  const r = await postNew(deps('failed', 'No cost yet for: Salt. Type a rate or receive it with a cost.'), form(), items, { userId: 'u', deviceId: 'phone-1234' });
  assert.match(r.error, /Purchase order/);
});

test('Post validates first: an invalid form is never queued', async () => {
  const d = deps('synced');
  const r = await postNew(d, form({ madeQty: '' }), items, { userId: 'u', deviceId: 'phone-1234' });
  assert.equal(r.ok, false);
  assert.equal(d.log.length, 0);
});

test('costing follows the restaurant switch like the web voucher: sent when on, left out when off or unknown', async () => {
  assert.deepEqual(voucherBody(form(), items, { post: true, costing: true }).costing, { enabled: true, costs: [] });
  assert.equal('costing' in voucherBody(form(), items, { post: true, costing: false }), false);
  assert.equal(await loadCosting(sendOf([{ status: 200, data: { enabled: true } }]), 'br'), true);
  assert.equal(await loadCosting(sendOf([{ status: 200, data: { enabled: false } }]), 'br'), false);
  assert.equal(await loadCosting(sendOf([{ status: 0, data: null }]), 'br'), null); // unreachable: the last known answer is used
  const s = sendOf([{ status: 201, data: { id: 'd', entryNo: 'PR-2' } }]);
  await saveDraft(s, 'br', form(), items, { costing: true });
  assert.equal(s.calls[0].body.costing.enabled, true);
});

test('a posted-with-costing voucher carries costing into the queued record', async () => {
  const d = deps('synced');
  await postNew(d, form(), items, { userId: 'u', deviceId: 'phone-1234', costing: true });
  assert.equal(d.log[0][1].costing.enabled, true);
});
