// Keeps the phone and the restaurant server in step:
//   pullSnapshot  server -> phone   menu, prices, tables, settings
//   pushSales     phone -> server   every sale taken (each only ever recorded once)
import { kv, sales } from './store.js';
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
  try {
    localStorage.setItem('orderrestro.standalone.ready', '1'); // lets the "can't reach the server" page offer this
  } catch {
    /* storage blocked */
  }
  return s.data;
}

function payload(sale) {
  return {
    id: sale.id,
    localNumber: sale.localNumber,
    soldAt: sale.soldAt,
    type: sale.type,
    tableLabel: sale.tableLabel || undefined,
    items: sale.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, unitPrice: i.price })),
    discountPercent: sale.discountPercent || undefined,
    discountFlat: sale.discountFlat || undefined,
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, reference: p.reference })),
  };
}

/** Send what is waiting. Returns how many were recorded, and how many need attention. */
export async function pushSales(base) {
  const branchId = await kv.get('branchId');
  const device = (await kv.get('deviceName')) || 'Phone';
  let done = 0;
  let refused = 0;
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
        refused++;
      } else {
        sale.status = 'synced';
        sale.serverOrderNumber = res.orderNumber;
        sale.syncedAt = new Date().toISOString();
        done++;
      }
      await sales.put(sale);
    }
  }
  return { done, refused };
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
      if (refreshMenu) await pullSnapshot(base);
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
