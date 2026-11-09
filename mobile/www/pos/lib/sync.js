// Keeps the phone and the restaurant server in step:
//   pullSnapshot  server -> phone   menu, prices, tables, settings
//   pushSales     phone -> server   every sale taken (each only ever recorded once)
import { kv, reservations, sales } from './store.js';
import { mergeFromServer, toPayload } from './reservations.js';
import { pickServer, request } from './net.js';

export class AuthExpired extends Error {}

export async function login(base, identifier, password) {
  const r = await request(base, 'POST', '/api/v1/auth/login', { email: identifier, password });
  if (r.status === 429) throw new Error('Too many attempts. Wait a minute and try again.');
  if (r.status !== 201 && r.status !== 200) {
    throw new Error((r.data && r.data.message) || 'That email, phone or password is not right.');
  }
  await kv.set('serverBase', base);
}

export async function pullSnapshot(base) {
  const b = await request(base, 'GET', '/api/v1/branches');
  if (b.status === 401) throw new AuthExpired();
  if (b.status !== 200 || !Array.isArray(b.data) || b.data.length === 0) throw new Error('No branch is set up for this account.');
  const wanted = await kv.get('branchId');
  const branch = b.data.find((x) => x.id === wanted) || b.data[0];
  const s = await request(base, 'GET', `/api/v1/mobile/standalone/snapshot?branchId=${encodeURIComponent(branch.id)}`);
  if (s.status === 401) throw new AuthExpired();
  if (s.status === 403) throw new Error('This account may not take orders.');
  if (s.status !== 200) throw new Error('The server could not send the menu. Try again in a moment.');
  await kv.set('branchId', branch.id);
  await kv.set('snapshot', s.data);
  await kv.set('snapshotAt', Date.now());
  await mergeBookings(s.data);
  try {
    localStorage.setItem('orderrestro.standalone.ready', '1'); // lets the "can't reach the server" page offer this
  } catch {
    /* storage blocked */
  }
  return s.data;
}

const tablesOf = (snap) => ((snap && snap.floors) || []).flatMap((f) => f.tables);

/** Bookings the server sent replace the phone's sent copies; unsent edits are kept. */
async function mergeBookings(snap) {
  if (!Array.isArray(snap.reservations)) return;
  const tables = tablesOf(snap);
  const merged = mergeFromServer(await reservations.all(), snap.reservations, (id) => (tables.find((t) => t.id === id) || {}).label);
  for (const b of merged) await reservations.put(b);
}

/** Send bookings made or changed on the phone; keep the server's copy of each answer. */
export async function pushBookings(base) {
  const branchId = await kv.get('branchId');
  const snap = await kv.get('snapshot');
  if (!snap || !Array.isArray(snap.reservations)) return { sent: 0, newer: 0 }; // older server: nothing to send to
  const tables = tablesOf(snap);
  const tableIdOf = (label) => (tables.find((t) => t.label === label) || {}).id;
  const waiting = (await reservations.all()).filter((b) => b.dirty);
  let sent = 0;
  let newer = 0;
  for (let i = 0; i < waiting.length; i += 50) {
    const batch = waiting.slice(i, i + 50);
    const r = await request(base, 'POST', `/api/v1/mobile/standalone/reservations?branchId=${encodeURIComponent(branchId)}`, {
      deviceName: (await kv.get('deviceName')) || 'Phone',
      reservations: batch.map((b) => toPayload(b, tableIdOf)),
    });
    if (r.status === 401) throw new AuthExpired();
    if (r.status === 403) return { sent, newer, denied: true }; // this account may not manage bookings
    if (r.status !== 201 && r.status !== 200) throw new Error('The server did not accept the bookings yet. They stay on this phone.');
    for (const res of r.data.results) {
      const local = batch.find((b) => b.id === res.key);
      if (!local) continue;
      if (res.status === 'refused') {
        await reservations.put({ ...local, dirty: false, syncError: res.reason || 'The server refused this booking.' });
        continue;
      }
      const label = res.reservation && res.reservation.tableId ? (tables.find((t) => t.id === res.reservation.tableId) || {}).label : local.tableLabel;
      await reservations.put({ ...local, ...(res.reservation || {}), tableLabel: label || '', dirty: false, syncError: undefined });
      if (res.status === 'server_newer') newer++;
      else sent++;
    }
  }
  return { sent, newer };
}

function payload(sale) {
  return {
    id: sale.id,
    localNumber: sale.localNumber,
    soldAt: sale.soldAt,
    type: sale.type,
    tableLabel: sale.tableLabel || undefined,
    note: sale.note || undefined,
    items: sale.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, unitPrice: i.price })),
    discountPercent: sale.discountPercent || undefined,
    discountFlat: sale.discountFlat || undefined,
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, reference: p.reference })),
  };
}

/** Put a refused sale back in the queue (e.g. after the owner restored the dish on the server). */
export async function retrySale(id) {
  const sale = await sales.get(id);
  if (!sale || (sale.status !== 'refused' && sale.status !== 'dismissed')) return false;
  sale.status = 'pending';
  await sales.put(sale);
  return true;
}

/** Send what is waiting. Returns how many were recorded, and how many need attention. */
export async function pushSales(base) {
  const branchId = await kv.get('branchId');
  const device = (await kv.get('deviceName')) || 'Phone';
  let done = 0;
  let refused = 0;
  let reviewed = 0;
  const waiting = (await sales.pending()).reverse(); // oldest first
  for (let i = 0; i < waiting.length; i += 20) {
    const batch = waiting.slice(i, i + 20);
    const r = await request(base, 'POST', `/api/v1/mobile/standalone/sales?branchId=${encodeURIComponent(branchId)}`, {
      deviceName: device,
      sales: batch.map(payload),
    });
    if (r.status === 401) throw new AuthExpired();
    if (r.status !== 201 && r.status !== 200) throw new Error('The server did not accept the sales yet. They stay on this phone.');
    for (const res of r.data.results) {
      const sale = batch.find((s) => s.id === res.id);
      if (!sale) continue;
      if (res.status === 'refused') {
        sale.status = 'refused';
        sale.refusedReason = res.reason;
        sale.refusedCode = res.code || 'OTHER';
        refused++;
      } else {
        // Recorded, but the menu moved since the phone last looked: keep what the owner should check.
        sale.review = Array.isArray(res.review) && res.review.length ? res.review : undefined;
        if (sale.review) reviewed++;
        sale.status = 'synced';
        delete sale.refusedReason;
        delete sale.refusedCode;
        sale.serverOrderNumber = res.orderNumber;
        sale.syncedAt = new Date().toISOString();
        done++;
      }
      await sales.put(sale);
    }
  }
  return { done, refused, reviewed };
}

let running = null;
/** One sync at a time: push the waiting sales, then refresh the menu. Quietly does nothing when offline. */
export function syncNow({ refreshMenu = true } = {}) {
  if (running) return running;
  running = (async () => {
    const out = { online: false, done: 0, refused: 0, error: null, authExpired: false };
    try {
      const snap = await kv.get('snapshot');
      if (snap && snap.local) return out; // on-this-phone mode: nothing to sync until a server is connected
      const base = await pickServer(await kv.get('serverBase'));
      if (!base) return out;
      out.online = true;
      const r = await pushSales(base);
      out.done = r.done;
      out.refused = r.refused;
      out.reviewed = r.reviewed;
      if (refreshMenu) await pullSnapshot(base); // also brings the server's bookings
      const b = await pushBookings(base);
      out.bookings = b.sent;
      out.bookingsNewer = b.newer;
      await kv.set('lastSync', Date.now());
    } catch (e) {
      if (e instanceof AuthExpired) out.authExpired = true;
      else out.error = e.message;
    } finally {
      running = null;
    }
    return out;
  })();
  return running;
}
