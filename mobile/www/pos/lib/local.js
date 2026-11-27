// "On this phone" mode: an account, a restaurant and a menu that live only on
// the phone (IndexedDB), so the app is usable before any server exists. Later
// the owner connects a server; the sales taken here are then matched to the
// server's dishes by name and sent (see remapSalesToServer).
import { currencyCode, supportsUpi } from './money.js';
import { planTables } from './tables.js';
import { expenses, kv, kots, newId, orders, refunds, sales, shifts } from './store.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 150000 }, key, 256);
  return hex(bits);
}

export const isLocal = (snap) => !!(snap && snap.local);
export const hasLocalAccount = async () => !!(await kv.get('localAccount'));

// Validate the user's choices before creating the account or writing its snapshot.
function regionalSettings({ country, currency, timezone, upiVpa }) {
  country = String(country || '').trim().toUpperCase();
  currency = currencyCode(currency);
  timezone = String(timezone || '').trim();
  const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }) : null;
  if (!/^[A-Z]{2}$/.test(country) || country === 'ZZ' || (names && !names.of(country))) {
    throw new Error('Enter a two-letter country code, for example BR or IN.');
  }
  if (!currency || (Intl.supportedValuesOf && !Intl.supportedValuesOf('currency').includes(currency))) {
    throw new Error('Enter a valid currency code, for example BRL or EUR.');
  }
  if (!/^[A-Za-z]/.test(timezone)) throw new Error('Enter a time zone, for example America/Sao_Paulo.');
  try { new Intl.DateTimeFormat(undefined, { timeZone: timezone }); }
  catch { throw new Error('Enter a valid time zone, for example America/Sao_Paulo.'); }
  upiVpa = supportsUpi(currency) ? String(upiVpa || '').trim() || null : null;
  if (upiVpa && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upiVpa)) throw new Error('A UPI id looks like name@bank.');
  return { country, currency, timezone, upiVpa };
}

export async function saveLocalRegion(snap, values) {
  if (!isLocal(snap)) throw new Error('Change the regional settings on your restaurant server.');
  const { country, ...restaurant } = regionalSettings(values);
  // Sales made before currency was stored on each bill keep their previous denomination.
  if (snap.restaurant.currency !== restaurant.currency && !snap.restaurant.legacySaleCurrency) {
    restaurant.legacySaleCurrency = snap.restaurant.currency;
  }
  return saveSnap({ ...snap, branch: { ...snap.branch, country }, restaurant: { ...snap.restaurant, ...restaurant } });
}

/** Create the account and an empty restaurant. Returns the snapshot. */
export async function createLocalAccount({ name, email, password, restaurant, ...region }) {
  name = String(name || '').trim();
  restaurant = String(restaurant || '').trim();
  email = String(email || '').trim();
  if (!name) throw new Error('Enter your name.');
  if (!restaurant) throw new Error('Enter the name of your restaurant or shop.');
  if (String(password || '').length < 6) throw new Error('Choose a password of at least 6 characters.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('That email address does not look right.');
  const { country, ...settings } = regionalSettings(region);
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const account = { name, email, salt, hash: await hashPassword(password, salt), createdAt: new Date().toISOString() };
  const snap = {
    local: true,
    generatedAt: new Date().toISOString(),
    user: { id: 'local', name, permissions: [] },
    restaurant: { name: restaurant, ...settings, upiPayeeName: restaurant, maxManualDiscountPercent: 100 },
    branch: { id: 'local', country, name: restaurant, address: null, phone: null, gstNumber: null, taxRegime: null, taxMode: 'INCLUSIVE', taxLabel: 'Tax', taxId: null, printerPaperWidthMm: 58, printerColumns: 32 },
    categories: [],
    items: [],
    floors: [],
  };
  await kv.setMany([['localAccount', account], ['snapshot', snap], ['snapshotAt', Date.now()], ['branchId', 'local']]);
  await kv.del('serverBase');
  return snap;
}

export async function checkLocalPassword(password) {
  const a = await kv.get('localAccount');
  if (!a) return false;
  return (await hashPassword(password, a.salt)) === a.hash;
}

export async function saveSnap(snap) {
  snap.generatedAt = new Date().toISOString();
  await kv.set('snapshot', snap);
  return snap;
}

/** Add or update a dish. Returns the updated snapshot. */
/**
 * Add-ons typed one per line, "Extra cheese = 30" (price optional), into the one optional "Add-ons" group a phone dish
 * has. Keeps the ids of add-ons that were already there, so open orders still match.
 */
export function parseAddOns(text, old = [], locale = globalThis.navigator?.language) {
  const format = new Intl.NumberFormat(locale, { numberingSystem: 'latn', useGrouping: false });
  const decimal = format.formatToParts(1.5).find((p) => p.type === 'decimal').value;
  const choices = [];
  for (const raw of String(text || '').split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)(?:\s*[=:]\s*(?:₹|rs\.?)?\s*(-?\d+(?:[.,٫]\d+)?))?$/i);
    const name = (m[1] || '').trim().slice(0, 60);
    const price = m[2] != null ? Number(m[2].replace(decimal, '.')) : 0;
    if (!name) continue;
    if (!Number.isFinite(price) || price < 0) throw new Error(`Add-on "${name}" needs a price of 0 or more.`);
    if (choices.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    const was = old.find((c) => c.name.toLowerCase() === name.toLowerCase());
    choices.push({ id: was ? was.id : `loc-${newId()}`, name, price: Math.round(price * 100) / 100 });
  }
  if (choices.length > 30) throw new Error('Keep it to 30 add-ons or fewer.');
  return choices;
}
export function addOnsText(item, locale = globalThis.navigator?.language) {
  const format = new Intl.NumberFormat(locale, { numberingSystem: 'latn', useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (item?.options?.[0]?.choices || []).map((c) => c.price ? `${c.name} = ${format.format(c.price)}` : c.name).join('\n');
}

export async function upsertDish(snap, { id, name, price, taxRate, isVeg, categoryName, stock, soldOut, halfPrice, barcode, addOns }) {
  name = String(name || '').trim();
  price = Number(price);
  taxRate = Number(taxRate || 0);
  if (!name) throw new Error('Enter the dish name.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a price, for example 120.');
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error('Tax must be between 0 and 100.');
  const dup = snap.items.find((i) => i.id !== id && i.name.toLowerCase() === name.toLowerCase());
  if (dup) throw new Error('A dish with that name already exists.');
  let categoryId = null;
  const cn = String(categoryName || '').trim();
  if (cn) {
    let c = snap.categories.find((x) => x.name.toLowerCase() === cn.toLowerCase());
    if (!c) {
      c = { id: `loc-${newId()}`, name: cn, sortOrder: snap.categories.length };
      snap.categories.push(c);
    }
    categoryId = c.id;
  }
  const old = id && snap.items.find((i) => i.id === id);
  // Stock: blank = not counted. A number counts down with every sale and switches the dish off at 0.
  let count = null;
  if (stock !== undefined && stock !== null && String(stock).trim() !== '') {
    count = Number(stock);
    if (!Number.isInteger(count) || count < 0 || count > 100000) throw new Error('Stock must be a whole number, or leave it empty.');
  } else if (stock === undefined && old && old.stock != null) count = old.stock;
  // Half portion: blank = none.
  let half = old ? (old.halfPrice ?? null) : null;
  if (halfPrice !== undefined) {
    half = String(halfPrice ?? '').trim() === '' ? null : Number(halfPrice);
    if (half != null && (!Number.isFinite(half) || half < 0)) throw new Error('Half price must be a number, or leave it empty.');
    if (half != null) half = Math.round(half * 100) / 100;
  }
  const code = barcode !== undefined ? String(barcode || '').trim().slice(0, 64) || null : (old && old.barcode) || null;
  if (code && snap.items.some((i) => i.id !== id && i.barcode === code)) throw new Error('Another dish already has that barcode.');
  let options = (old && old.options) || [];
  if (addOns !== undefined) {
    const choices = parseAddOns(addOns, (options[0] && options[0].choices) || []);
    options = choices.length ? [{ id: (options[0] && options[0].id) || `loc-${newId()}`, name: 'Add-ons', min: 0, max: choices.length, choices }] : [];
  }
  const row = { id: id || `loc-${newId()}`, categoryId, name, price: Math.round(price * 100) / 100, halfPrice: half, barcode: code, options, taxRate, isVeg: !!isVeg, sellOffline: true, stock: count, soldOut: (count != null && count <= 0) || (soldOut !== undefined ? !!soldOut : !!(old && old.soldOut)) };
  const at = snap.items.findIndex((i) => i.id === row.id);
  if (at >= 0) snap.items[at] = row;
  else snap.items.push(row);
  snap.items.sort((a, b) => a.name.localeCompare(b.name));
  return saveSnap(snap);
}

export async function removeDish(snap, id) {
  snap.items = snap.items.filter((i) => i.id !== id);
  // Past sales keep their own copy of the name and price, so deleting is safe.
  return saveSnap(snap);
}

/**
 * Before the phone switches to a server's menu: point every waiting sale at the
 * server dish with the same name. Sales with a dish the server does not have are
 * marked "refused" (they stay on the phone and can be entered by the owner).
 */
export async function remapSalesToServer(serverItems) {
  const byName = new Map(serverItems.map((i) => [i.name.trim().toLowerCase(), i]));
  let matched = 0;
  let unmatched = 0;
  for (const s of await sales.pending()) {
    const missing = [];
    for (const line of s.items) {
      if (!String(line.menuItemId).startsWith('loc-')) continue;
      const hit = byName.get(String(line.baseName || line.name).trim().toLowerCase());
      if (!hit || hit.sellOffline === false || (line.portion === 'HALF' && hit.halfPrice == null)) {
        missing.push(line.name);
        continue;
      }
      // Phone add-ons become the server's add-ons of the same name on that dish.
      const serverChoices = (hit.options || []).flatMap((g) => g.choices);
      const mapped = (line.mods || []).map((m) => serverChoices.find((c) => c.name.trim().toLowerCase() === m.name.trim().toLowerCase()));
      if (mapped.some((c) => !c)) {
        missing.push(line.name);
        continue;
      }
      line.menuItemId = hit.id;
      line.modifierIds = mapped.map((c) => c.id);
    }
    if (missing.length) {
      s.status = 'refused';
      s.refusedReason = `The server menu has no dish (or add-on) for ${[...new Set(missing)].join(', ')}.`;
      unmatched++;
    } else matched++;
    await sales.put(s);
  }
  return { matched, unmatched };
}

/** Change the phone-account password (needs the current one). */
export async function changeLocalPassword(current, next) {
  if (!(await checkLocalPassword(current))) throw new Error('The current password is not right.');
  if (String(next || '').length < 6) throw new Error('Choose a new password of at least 6 characters.');
  const a = await kv.get('localAccount');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await kv.set('localAccount', { ...a, salt, hash: await hashPassword(next, salt) });
}

/** Forgot the password: wipe the phone account, its menu and its sales so a new one can be made. */
export async function eraseLocalAccount() {
  await sales.clear();
  await orders.clear();
  await kots.clear();
  await refunds.clear();
  await expenses.clear();
  await shifts.clear();
  for (const k of ['localAccount', 'snapshot', 'snapshotAt', 'branchId', 'localMenuBackup', 'serverBase']) await kv.del(k);
}

// ---- sections and tables (phone-account mode; with a server they come from the server)
const allTables = (snap) => snap.floors.flatMap((f) => f.tables);

export async function addSection(snap, name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Enter a name for the section, for example Ground floor.');
  if (snap.floors.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new Error('A section with that name already exists.');
  snap.floors.push({ id: `loc-${newId()}`, name, tables: [] });
  return saveSnap(snap);
}

export async function addTable(snap, floorId, { label, capacity }) {
  label = String(label || '').trim();
  capacity = Number(capacity || 4);
  if (!label) throw new Error('Enter a table name or number.');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) throw new Error('Seats must be a whole number from 1 to 50.');
  if (allTables(snap).some((t) => t.label.toLowerCase() === label.toLowerCase())) throw new Error('A table with that name already exists.');
  const floor = snap.floors.find((f) => f.id === floorId);
  if (!floor) throw new Error('Choose a section first.');
  floor.tables.push({ id: `loc-${newId()}`, label, capacity });
  return saveSnap(snap);
}

/** Several tables at once (T1..T10). Checks every name first, so either all are added or none. */
export async function addTables(snap, floorId, { prefix, from, count, capacity }) {
  capacity = Number(capacity || 4);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) throw new Error('Seats must be a whole number from 1 to 50.');
  const floor = snap.floors.find((f) => f.id === floorId);
  if (!floor) throw new Error('Choose a section first.');
  const labels = planTables({ existing: allTables(snap).map((t) => t.label), prefix, from, count });
  for (const label of labels) floor.tables.push({ id: `loc-${newId()}`, label, capacity });
  return saveSnap(snap);
}

/** Removing a table never touches orders: the caller refuses while one is open on it. */
export async function removeTable(snap, tableId) {
  for (const f of snap.floors) f.tables = f.tables.filter((t) => t.id !== tableId);
  return saveSnap(snap);
}

export async function removeSection(snap, floorId) {
  snap.floors = snap.floors.filter((f) => f.id !== floorId);
  return saveSnap(snap);
}

/** Switch a dish off for today ("86") or back on, without deleting it. */
export async function setSoldOut(snap, id, soldOut) {
  const item = snap.items.find((i) => i.id === id);
  if (!item) return snap;
  item.soldOut = !!soldOut;
  if (!soldOut && item.stock != null && item.stock <= 0) item.stock = null; // switched back on by hand: stop counting
  return saveSnap(snap);
}

/** After a sale: take sold quantities off counted dishes; a dish that reaches 0 switches itself off. */
export async function useStock(snap, lines, alsoSet = []) {
  // Work on a copy and only hand it back once it is saved. If the write fails the caller's snapshot is
  // untouched, so a retry deducts exactly once instead of twice (or, when guarded, not at all).
  // Copy only the dishes this sale touches. Cloning the whole menu on every sale made a large garbage
  // spike on low-RAM phones.
  const next = { ...snap, items: snap.items.slice() };
  let changed = false;
  for (const l of lines) {
    const at = next.items.findIndex((i) => i.id === l.menuItemId);
    if (at < 0 || next.items[at].stock == null) continue;
    const item = (next.items[at] = { ...next.items[at] });
    item.stock = Math.max(0, item.stock - l.quantity);
    if (item.stock === 0) item.soldOut = true;
    changed = true;
  }
  if (!changed) {
    if (alsoSet.length) await kv.setMany(alsoSet);
    return snap;
  }
  // The snapshot and any marker the caller wants (e.g. "this sale's stock is deducted") commit together.
  next.generatedAt = new Date().toISOString();
  await kv.setMany([['snapshot', next], ...alsoSet]);
  return next;
}
