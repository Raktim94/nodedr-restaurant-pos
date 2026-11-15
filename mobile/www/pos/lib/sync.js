// Keeps the phone and the restaurant server in step:
//   pullSnapshot  server -> phone   menu, prices, tables, settings
//   pushSales     phone -> server   every sale taken (each only ever recorded once)
import { kv, reservations, sales } from './store.js';
import { mergeFromServer, toPayload } from './reservations.js';
import { pickServer, request, serverInfo } from './net.js';
import { BOOK_EVENTS, SALE_EVENTS, counts, pruneSynced, pushEvents, DeviceRevoked, AuthExpired as EventAuthExpired } from './journal.js';

export class AuthExpired extends Error {}

export async function login(base, identifier, password) {
  const r = await request(base, 'POST', '/api/v1/auth/login', { email: identifier, password, deviceId: (await kv.get('deviceId')) || undefined });
  if (r.status === 403 && r.data && r.data.code === 'DEVICE_REVOKED') throw new Error('The owner removed this phone from the restaurant. Ask them to allow it again.');
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
  await saveServerCaps(base);
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

/**
 * What this server can take from a phone (GET /mobile/server-info). Servers older than 1.38 drop add-ons, pay later
 * and the service charge from a sale without saying so, and have nowhere to put refunds or expenses, so the phone
 * only offers those when the server says it can. Kept with the snapshot; refreshed on every menu refresh, so updating
 * the server switches them on at the next sync.
 */
async function saveServerCaps(base) {
  try {
    const info = await serverInfo(base);
    if (info) await kv.set('serverCaps', { ...(info.capabilities || {}), version: info.version || 'unknown' });
  } catch {
    /* keep what we had */
  }
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

const paidAtSend = (sale) => [...sale.payments, ...(sale.collections || []).filter((c) => !c.eventId)].reduce((n, p) => n + p.amount, 0);

function payload(sale) {
  return {
    id: sale.id,
    localNumber: sale.localNumber,
    soldAt: sale.soldAt,
    type: sale.type,
    tableLabel: sale.tableLabel || undefined,
    note: sale.note || undefined,
    items: sale.items.map((i) => ({
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      unitPrice: i.price,
      ...(i.modifierIds && i.modifierIds.length ? { modifierIds: i.modifierIds } : {}),
      ...(i.portion ? { portion: i.portion } : {}),
      ...(i.note ? { note: i.note } : {}),
    })),
    discountPercent: sale.discountPercent || undefined,
    discountFlat: sale.discountFlat || undefined,
    discountReason: sale.discountReason || undefined,
    tipAmount: sale.bill.serviceCharge || undefined,
    customer: sale.customer && sale.customer.phone ? { phone: sale.customer.phone, ...(sale.customer.name ? { name: sale.customer.name } : {}) } : undefined,
    takenByUserId: sale.staffServerId || undefined,
    // Money collected before the sale reached the server goes with it; after that, each collection is its own event.
    payments: [...sale.payments, ...(sale.collections || []).filter((c) => !c.eventId)].map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, reference: p.reference })),
    payLater: sale.payLater && paidAtSend(sale) < sale.bill.total - 0.004 ? true : undefined,
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
        sale.serverOrderId = res.orderId;
        // Collections taken before this point went with the sale.
        for (const c of sale.collections || []) if (!c.eventId) c.sentWithSale = true;
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
      // Each part is tried on its own: a sales upload that fails must not stop the kitchen records or bookings from
      // being sent, and a refusal in one never hides what happened to the others.
      let r = { done: 0, refused: 0, reviewed: 0 };
      let partial = null;
      try {
        r = await pushSales(base);
      } catch (e) {
        if (e instanceof AuthExpired) throw e;
        partial = e.message;
      }
      try {
        // A refund or a collection waits until the server has its sale (it may still be waiting, or was refused).
        if (!(await kv.get('serverCaps'))) await saveServerCaps(base); // first sync after this app update
        const caps = (await kv.get('serverCaps')) || {};
        const hold = async (e) => {
          // An older server has no route for these yet: keep them waiting (not refused) until it is updated.
          if (BOOK_EVENTS.has(e.kind) && !caps.phoneBooksSync) return true;
          if (!SALE_EVENTS.has(e.kind)) return false;
          const s = await sales.get(e.payload.saleId);
          return !!s && s.status !== 'synced';
        };
        const ev = await pushEvents(base, await kv.get('branchId'), request, undefined, { hold });
        out.events = ev.done;
        out.eventsFailed = ev.failed;
      } catch (e) {
        if (e instanceof DeviceRevoked) {
          out.revoked = true;
          return out;
        }
        if (e instanceof EventAuthExpired) throw new AuthExpired();
        throw e;
      }
      out.done = r.done;
      out.refused = r.refused;
      out.reviewed = r.reviewed;
      if (refreshMenu) {
        try {
          await pullSnapshot(base); // also brings the server's bookings
        } catch (e) {
          if (e instanceof AuthExpired) throw e;
          partial = partial || e.message;
        }
      }
      try {
        const b = await pushBookings(base);
        out.bookings = b.sent;
        out.bookingsNewer = b.newer;
      } catch (e) {
        if (e instanceof AuthExpired) throw e;
        partial = partial || e.message;
      }
      try {
        await pruneSynced();
      } catch {
        /* housekeeping only */
      }
      if (partial) {
        out.error = partial;
      } else {
        await kv.set('lastSync', Date.now());
      }
      await heartbeat(base, !partial, out.error);
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

/** Tell the server this phone exists, how many things are waiting on it, and that it just synced. Never blocks selling. */
export async function heartbeat(base, synced = false, lastError) {
  try {
    const c = await counts();
    const sa = (await sales.all()).filter((s) => s.status === 'pending').length;
    const refused = (await sales.all()).filter((s) => s.status === 'refused').length;
    const r = await request(base, 'POST', '/api/v1/pos-devices/heartbeat', {
      deviceId: await kv.get('deviceId'),
      name: (await kv.get('deviceName')) || 'Phone',
      platform: (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() || 'web').toUpperCase().slice(0, 20),
      appVersion: window.__APP_VERSION__ || undefined,
      pending: sa + c.pending,
      failed: refused + c.failed,
      lastError: lastError || undefined,
      synced,
    });
    return r.status === 403 || (r.status === 401 && r.data && r.data.code === 'DEVICE_REVOKED') ? 'revoked' : 'ok';
  } catch {
    return 'offline';
  }
}
