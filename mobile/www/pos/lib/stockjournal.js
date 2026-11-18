// Stock journal on the phone (Kitchen tab): the rules, the requests and the small flows behind the screen.
// Nothing here decides anything about stock. Every number is checked and every movement is made by the server, with
// the same routes and the same permissions as the web app (apps/web/components/inventory/stock-journal-voucher.tsx).
// The phone only shows or hides buttons by what the account may do, and refuses obviously empty or unreadable input
// before it asks. `send(method, path, body)` is injected so these can be tested without a network.
import { newId } from './journal.js';

/** Shown only when the server answered for the chosen product and had no recipe for it. */
export const NO_RECIPES_FOR_PRODUCT = 'No saved recipes for this product yet';

/**
 * What the recipe area says. "empty" is only ever the answer to a request that succeeded and returned nothing for the
 * chosen product: no product chosen, no connection, a pending request or a failed one are all different states.
 */
export function recipeState({ hasProduct, online = true, loading = false, error = false, loaded = false, count = 0 }) {
  if (!hasProduct) return 'choose-product';
  if (loading) return 'loading';
  if (error) return 'error';
  if (!loaded) return online ? 'loading' : 'offline';
  return count === 0 ? 'empty' : 'ready';
}

/** Unit the item cannot be entered in, as a readable sentence, or null when fine. */
export function unitProblem(item, unit) {
  if (!item || !unit || (item.units || []).includes(unit)) return null;
  return `${item.name} is stocked in ${item.unit}, so it cannot be entered in ${unit}. Choose ${item.units.join(', ')}, or add a conversion to the item first.`;
}

/** Buttons this account may use. The snapshot says (1.40+); older servers only tell us whether they may receive stock. */
export function capsFrom(snap) {
  if (!snap || !Array.isArray(snap.stockItems)) return { record: false, post: false, recipes: false, inventoryItems: false, menuItems: false, report: false };
  if (snap.stockCaps) return { record: true, post: false, recipes: false, inventoryItems: false, menuItems: false, report: false, ...snap.stockCaps };
  // An older server: record and post as before; nothing that needs the newer routes is offered by guesswork.
  return { record: true, post: true, recipes: false, inventoryItems: false, menuItems: false, report: false };
}

export const emptyForm = () => ({
  draftId: null, // the server's draft being edited, if any
  draftNo: null,
  productId: '',
  madeQty: '',
  madeUnit: '',
  rejected: '',
  rows: [{ ingredientId: '', quantity: '', unit: '', expected: '' }],
  recipeKey: '', // "RECIPE:id" | "MENU:id" | ''
  shift: '',
  batchRef: '',
  notes: '',
  key: newId(), // the idempotency key of the next post of this form
  draftKey: newId(),
});

const positive = (v) => Number(String(v).trim()) > 0 && Number.isFinite(Number(String(v).trim()));

/** Why this form cannot be sent yet, in words, or null. `items` are the stock items the phone knows. */
export function formProblem(F, items) {
  const by = new Map((items || []).map((i) => [i.id, i]));
  if (!F.productId) return 'Choose the product you made.';
  if (!positive(F.madeQty)) return 'Type the good quantity made (more than zero).';
  const used = F.rows.filter((r) => r.ingredientId || String(r.quantity).trim());
  if (!used.length) return 'Add at least one ingredient used.';
  if (used.some((r) => !r.ingredientId)) return 'Choose the ingredient on every row.';
  if (used.some((r) => !positive(r.quantity))) return 'Every ingredient needs a quantity above zero.';
  if (new Set(used.map((r) => r.ingredientId)).size !== used.length) return 'An ingredient can appear only once.';
  if (used.some((r) => r.ingredientId === F.productId)) return 'The product made cannot also be an ingredient.';
  if (F.rejected !== '' && !(Number(F.rejected) >= 0)) return 'Rejected quantity must be zero or more.';
  const u = unitProblem(by.get(F.productId), F.madeUnit);
  if (u) return u;
  for (const r of used) {
    const p = unitProblem(by.get(r.ingredientId), r.unit);
    if (p) return p;
  }
  return null;
}

/** On-hand quantity in the item's own unit, or null when the phone does not know it (offline, older server). */
export const onHand = (item) => (item && item.currentStock !== undefined && item.currentStock !== null ? Number(item.currentStock) : null);

/** Rows that ask for more than is on hand (same unit only): a hint before sending. The server still decides. */
export function shortRows(F, items) {
  const by = new Map((items || []).map((i) => [i.id, i]));
  return F.rows.filter((r) => {
    const it = by.get(r.ingredientId);
    const have = onHand(it);
    return have !== null && it && r.unit === it.unit && Number(r.quantity) > have;
  });
}

/** The body the server takes for a production voucher. `post` true = post now, false = draft. */
export function voucherBody(F, items, { post, key, costing } = {}) {
  const used = F.rows.filter((r) => r.ingredientId);
  const body = {
    producedAt: new Date().toISOString(),
    inputs: used.map((r) => ({
      ingredientId: r.ingredientId,
      quantity: String(r.quantity).trim(),
      unit: r.unit || (items.find((i) => i.id === r.ingredientId) || {}).unit,
      ...(r.expected ? { expectedQuantity: String(r.expected) } : {}),
    })),
    outputs: [
      {
        ingredientId: F.productId,
        quantity: String(F.madeQty).trim(),
        unit: F.madeUnit || (items.find((i) => i.id === F.productId) || {}).unit,
        ...(Number(F.rejected) > 0 ? { rejectedQuantity: String(F.rejected).trim() } : {}),
      },
    ],
    ...(F.shift ? { shift: F.shift } : {}),
    ...(F.batchRef.trim() ? { batchRef: F.batchRef.trim() } : {}),
    ...(F.notes.trim() ? { notes: F.notes.trim() } : {}),
    ...(F.recipeKey ? { recipe: { kind: F.recipeKey.split(':')[0], id: F.recipeKey.split(':')[1] } } : {}),
  };
  // Costing follows the restaurant's switch, exactly like the web voucher: with it on, the server needs a cost for every
  // ingredient and freezes the batch cost. Additional costs (labour, packaging) are typed in the web app.
  if (costing) body.costing = { enabled: true, costs: [] };
  if (key) body.idempotencyKey = key;
  if (post !== undefined) body.post = post;
  return body;
}

/** A saved recipe is a template for one product at the quantity typed. It carries no stock movement. */
export function recipeProblem(F, items, name) {
  if (!F.productId) return 'Choose the product first.';
  if (!positive(F.madeQty)) return 'Type the good quantity first: the recipe is saved for that quantity.';
  const used = F.rows.filter((r) => r.ingredientId || String(r.quantity).trim());
  if (!used.length || used.some((r) => !r.ingredientId || !positive(r.quantity))) return 'Choose every ingredient and give each a quantity above zero.';
  if (!String(name || '').trim()) return 'Give the recipe a name.';
  const by = new Map((items || []).map((i) => [i.id, i]));
  for (const r of used) {
    const u = unitProblem(by.get(r.ingredientId), r.unit);
    if (u) return u;
  }
  return null;
}
export function recipeBody(F, items, name) {
  const used = F.rows.filter((r) => r.ingredientId);
  return {
    outputIngredientId: F.productId,
    name: String(name).trim(),
    baseOutputQty: String(F.madeQty).trim(),
    lines: used.map((r) => ({ ingredientId: r.ingredientId, quantity: String(r.quantity).trim(), unit: r.unit || (items.find((i) => i.id === r.ingredientId) || {}).unit })),
  };
}

/** Rows from a server "fill" answer: the quantities are the recipe's, the person then types what was really used. */
export function rowsFromFill(fill) {
  return (fill.lines || []).map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), unit: l.unit, expected: String(l.quantity) }));
}

/** A saved draft (GET inventory/production/:id) as a form. Outputs use the stock unit so good and rejected agree. */
export function formFromDraft(e) {
  const F = emptyForm();
  const out = (e.lines || []).find((l) => l.role === 'OUTPUT');
  F.draftId = e.id;
  F.draftNo = e.entryNo;
  F.productId = out ? out.ingredientId : '';
  F.madeQty = out ? String(out.quantity) : '';
  F.madeUnit = out && out.ingredient ? out.ingredient.unit : '';
  F.rejected = out && Number(out.rejectedQuantity) > 0 ? String(out.rejectedQuantity) : '';
  const rows = (e.lines || []).filter((l) => l.role === 'INPUT').map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.enteredQuantity), unit: l.enteredUnit, expected: l.expectedQuantity ? String(l.expectedQuantity) : '' }));
  if (rows.length) F.rows = rows;
  F.shift = e.shift || '';
  F.batchRef = e.batchRef || '';
  F.notes = e.notes || '';
  F.recipeKey = e.recipeKind && e.recipeId ? `${e.recipeKind}:${e.recipeId}` : '';
  return F;
}

/** What the server said, in words the person can act on. `r` is { status, data }. */
export function friendlyError(r) {
  const msg = r && r.data && (Array.isArray(r.data.issues) ? r.data.issues.map((i) => i.message).filter(Boolean)[0] : r.data.message);
  const status = r ? r.status : 0;
  if (status === 0) return 'No connection to the server. Nothing was changed. Your entries are still here.';
  if (status === 401) return 'You were signed out. Sign in again; your entries are kept on this phone.';
  if (status === 403) return 'This account is not allowed to do that. Ask the owner or a manager.';
  if (status === 409) return msg || 'That was already done, so nothing changed again. Check the journal for it.';
  if (status >= 500) return 'The server had a problem. Nothing was changed. Try again in a moment.';
  let text = msg || `The server refused it (${status}). Nothing was changed.`;
  if (/No cost yet/i.test(text)) {
    // The server's own advice mentions typing a rate, which the phone cannot do; say what the phone can do instead.
    text = text.replace(/\s*Type a rate or receive it with a cost\./i, '');
    text += ' Costing is on, so every ingredient needs a cost. Receive the ingredient with a unit cost (Purchase order > Receive, in the web app), or ask a manager to post this voucher from the web app, where a rate can be typed for it.';
  }
  return text;
}

// ------------------------------------------------------------------------------------------ flows ---

const qs = (branchId, extra = '') => `?branchId=${encodeURIComponent(branchId)}${extra}`;

/** GET inventory/recipes for ONE product. Never answers "empty" for a failure. */
export async function loadRecipes(send, branchId, productId) {
  let r;
  try {
    r = await send('GET', `/api/v1/inventory/recipes${qs(branchId, `&productId=${encodeURIComponent(productId)}`)}`);
  } catch {
    return { state: 'offline', recipes: [] };
  }
  if (r.status === 0) return { state: 'offline', recipes: [] };
  if (r.status !== 200 || !Array.isArray(r.data)) return { state: 'error', recipes: [], error: friendlyError(r) };
  return { state: r.data.length === 0 ? 'empty' : 'ready', recipes: r.data };
}

/** Is costed production switched on? true/false, or null when the server cannot be reached (the last answer is then used). */
export async function loadCosting(send, branchId) {
  try {
    const r = await send('GET', `/api/v1/inventory/manufacturing/settings${qs(branchId)}`);
    return r.status === 200 && r.data ? !!r.data.enabled : null;
  } catch {
    return null;
  }
}

/** The live stock items with on-hand quantity (GET inventory/production/items); null when it cannot be reached. */
export async function loadStockItems(send, branchId) {
  try {
    const r = await send('GET', `/api/v1/inventory/production/items${qs(branchId)}`);
    return r.status === 200 && Array.isArray(r.data) ? r.data : null;
  } catch {
    return null;
  }
}

/** Add an inventory item (a raw material). It is NOT put on the menu. Returns { ok, id } or { ok:false, error }. */
export async function createInventoryItem(send, branchId, { name, unit }) {
  if (!String(name || '').trim()) return { ok: false, error: 'Type the item name.' };
  const r = await send('POST', `/api/v1/inventory/ingredients${qs(branchId)}`, { name: String(name).trim(), unit, kind: 'PURCHASED', reorderLevel: 0, isActive: true, conversions: [] });
  if (r.status === 201 || r.status === 200) return { ok: true, id: r.data.id };
  return { ok: false, error: friendlyError(r) };
}

/**
 * Add a menu item (a finished product). Same three steps as the web voucher: the stock item, the menu entry, the link
 * that makes each sale take stock off it. If only the first step worked the stock item exists and is usable in the
 * voucher; the result says the menu entry is missing so the person is told, not left guessing.
 */
export async function createMenuItem(send, branchId, { name, unit, categoryId, price, tax }) {
  if (!String(name || '').trim()) return { ok: false, error: 'Type the item name.' };
  if (!categoryId) return { ok: false, error: 'Choose the menu category.' };
  if (String(price).trim() === '' || !(Number(price) >= 0)) return { ok: false, error: 'Type the selling price (tax included).' };
  if (String(tax).trim() === '' || !(Number(tax) >= 0) || Number(tax) > 100) return { ok: false, error: 'Type the tax rate in percent (0 if none).' };
  const ing = await send('POST', `/api/v1/inventory/ingredients${qs(branchId)}`, { name: String(name).trim(), unit: unit || 'PIECE', kind: 'PREPARED', reorderLevel: 0, isActive: true, conversions: [] });
  if (ing.status !== 201 && ing.status !== 200) return { ok: false, error: friendlyError(ing) };
  const stockId = ing.data.id;
  const m = await send('POST', `/api/v1/menu/items${qs(branchId)}`, { categoryId, name: String(name).trim(), price: Number(price), taxRatePercent: Number(tax), isVeg: true });
  if (m.status !== 201 && m.status !== 200) return { ok: true, id: stockId, menuMissing: friendlyError(m) };
  const link = await send('PATCH', `/api/v1/inventory/menu-items/${m.data.id}/tracking${qs(branchId)}`, { inventoryTracking: 'DIRECT', stockIngredientId: stockId, stockQuantityPerSale: 1 });
  if (link.status !== 200 && link.status !== 201) return { ok: true, id: stockId, menuMissing: friendlyError(link) };
  return { ok: true, id: stockId };
}

/** Save the form as a reusable recipe. Never touches stock. */
export async function saveRecipe(send, branchId, F, items, name) {
  const p = recipeProblem(F, items, name);
  if (p) return { ok: false, error: p };
  const r = await send('POST', `/api/v1/inventory/recipes${qs(branchId)}`, recipeBody(F, items, name));
  if (r.status === 201 || r.status === 200) return { ok: true, recipe: r.data };
  return { ok: false, error: friendlyError(r) };
}

/** Fill the rows from a saved recipe, scaled by the server to the planned good quantity. */
export async function fillFromRecipe(send, branchId, F) {
  if (!F.productId) return { ok: false, error: 'Choose the product first.' };
  if (!F.recipeKey) return { ok: false, error: 'Choose which recipe to fill from.' };
  if (!positive(F.madeQty)) return { ok: false, error: 'Type the planned good quantity first; the recipe is scaled to it.' };
  const [kind, id] = F.recipeKey.split(':');
  const r = await send('GET', `/api/v1/inventory/recipes/fill${qs(branchId, `&kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&quantity=${encodeURIComponent(String(F.madeQty).trim())}`)}`);
  if (r.status !== 200) return { ok: false, error: friendlyError(r) };
  return { ok: true, rows: rowsFromFill(r.data), name: r.data.recipe && r.data.recipe.name, version: r.data.recipe && r.data.recipe.version };
}

/** Save a draft on the server (online only). It never changes stock. A retry with the same form reuses its key. */
export async function saveDraft(send, branchId, F, items, { costing } = {}) {
  const p = formProblem(F, items);
  if (p) return { ok: false, error: p };
  const r = F.draftId
    ? await send('PATCH', `/api/v1/inventory/production/${encodeURIComponent(F.draftId)}${qs(branchId)}`, voucherBody(F, items, { costing }))
    : await send('POST', `/api/v1/inventory/production${qs(branchId)}`, voucherBody(F, items, { post: false, key: `phd-${F.draftKey}`, costing }));
  if (r.status === 201 || r.status === 200) return { ok: true, id: r.data.id, entryNo: r.data.entryNo };
  return { ok: false, error: friendlyError(r) };
}

/** Post a draft that is open in the form: save the edits, then post. The server posts a draft once; a second post is a 409. */
export async function postDraft(send, branchId, F, items, opts = {}) {
  const saved = await saveDraft(send, branchId, F, items, opts);
  if (!saved.ok) return saved;
  const r = await send('POST', `/api/v1/inventory/production/${encodeURIComponent(F.draftId)}/post${qs(branchId)}`, {});
  if (r.status === 201 || r.status === 200) return { ok: true, entryNo: F.draftNo };
  return { ok: false, error: `Your changes were saved to draft ${F.draftNo}, but it was not posted. ${friendlyError(r)}`, saved: true };
}

export async function deleteDraft(send, branchId, id) {
  const r = await send('DELETE', `/api/v1/inventory/production/${encodeURIComponent(id)}${qs(branchId)}`);
  return r.status === 200 || r.status === 204 ? { ok: true } : { ok: false, error: friendlyError(r) };
}

/**
 * Post a new voucher. It is written on the phone first (its id is the server's idempotency key), then sent at once if
 * the phone is online. A refusal (not enough stock, a unit, a missing cost) is shown to the person with the form
 * untouched, and the record is set aside so it never sends again; no connection leaves it waiting to send later.
 * deps: { queueEvent, syncNow, getEvent, dismissEvent }
 */
export async function postNew(deps, F, items, { userId, deviceId, costing }) {
  const p = formProblem(F, items);
  if (p) return { ok: false, error: p };
  const payload = voucherBody(F, items, { costing });
  const ev = await deps.queueEvent('production', payload, { userId, deviceId });
  let res;
  try {
    res = await deps.syncNow({ refreshMenu: false });
  } catch {
    res = { online: false };
  }
  const after = (await deps.getEvent(ev.id)) || ev;
  if (after.status === 'synced') return { ok: true, posted: true, eventId: ev.id };
  if (after.status === 'failed') {
    await deps.dismissEvent(ev.id);
    return { ok: false, refused: true, error: friendlyError({ status: 400, data: { message: after.error } }) };
  }
  return { ok: true, posted: false, waiting: true, online: !!(res && res.online), eventId: ev.id };
}
