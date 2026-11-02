// "On this phone" mode: an account, a restaurant and a menu that live only on
// the phone (IndexedDB), so the app is usable before any server exists. Later
// the owner connects a server; the sales taken here are then matched to the
// server's dishes by name and sent (see remapSalesToServer).
import { kv, newId, sales } from './store.js';

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

/** Create the account and an empty restaurant. Returns the snapshot. */
export async function createLocalAccount({ name, email, password, restaurant, upiVpa }) {
  name = String(name || '').trim();
  restaurant = String(restaurant || '').trim();
  email = String(email || '').trim();
  if (!name) throw new Error('Enter your name.');
  if (!restaurant) throw new Error('Enter the name of your restaurant or shop.');
  if (String(password || '').length < 6) throw new Error('Choose a password of at least 6 characters.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('That email address does not look right.');
  if (upiVpa && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upiVpa.trim())) throw new Error('A UPI id looks like name@bank.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  await kv.set('localAccount', { name, email, salt, hash: await hashPassword(password, salt), createdAt: new Date().toISOString() });
  const snap = {
    local: true,
    generatedAt: new Date().toISOString(),
    user: { id: 'local', name, permissions: [] },
    restaurant: { name: restaurant, currency: 'INR', timezone: 'Asia/Kolkata', upiVpa: (upiVpa || '').trim() || null, upiPayeeName: restaurant, maxManualDiscountPercent: 100 },
    branch: { id: 'local', name: restaurant, address: null, phone: null, gstNumber: null, taxRegime: null, taxMode: 'INCLUSIVE', taxLabel: 'Tax', taxId: null, printerPaperWidthMm: 58, printerColumns: 32 },
    categories: [],
    items: [],
    floors: [],
  };
  await kv.set('snapshot', snap);
  await kv.set('snapshotAt', Date.now());
  await kv.set('branchId', 'local');
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
export async function upsertDish(snap, { id, name, price, taxRate, isVeg, categoryName }) {
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
  const row = { id: id || `loc-${newId()}`, categoryId, name, price: Math.round(price * 100) / 100, taxRate, isVeg: !!isVeg, sellOffline: true };
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
      const hit = byName.get(String(line.name).trim().toLowerCase());
      if (hit && hit.sellOffline !== false) line.menuItemId = hit.id;
      else missing.push(line.name);
    }
    if (missing.length) {
      s.status = 'refused';
      s.refusedReason = `The server menu has no dish called ${[...new Set(missing)].join(', ')}.`;
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
  for (const k of ['localAccount', 'snapshot', 'snapshotAt', 'branchId', 'localMenuBackup', 'serverBase']) await kv.del(k);
}
