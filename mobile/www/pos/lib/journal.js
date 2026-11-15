// Production, waste, stock transfers and corrections taken in the kitchen, kept on the phone until the server has them.
// Each event has its own id, which is also the idempotency key the server uses, so sending one twice
// (a dropped connection, a retry after a crash) never changes stock twice.
import { events } from './store.js';

export const newId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `ev-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Save an event. It is on disk before anything is sent. */
export async function queueEvent(kind, payload, { userId, deviceId, now = new Date(), store = events } = {}) {
  const ev = {
    id: `${deviceId || 'dev'}-${newId()}`, // >= 8 chars, unique per event
    kind, // 'production' | 'waste' | 'receipt' | 'transfer' | 'correction' | 'attendance' | 'refund' | 'expense' | 'collect' | 'tillclose'
    payload,
    userId,
    deviceId,
    schema: 1,
    createdAt: now.toISOString(),
    status: 'pending', // pending | synced | failed
    attempts: 0,
  };
  await store.put(ev);
  return ev;
}

const PATH = {
  production: '/api/v1/inventory/production',
  waste: '/api/v1/inventory/waste/entries',
  receipt: '/api/v1/inventory/journal/receipts',
  transfer: '/api/v1/inventory/journal/entries',
  correction: '/api/v1/inventory/journal/entries',
  attendance: '/api/v1/attendance/events',
  // The phone's books (standalone POS): each takes the event id as its idempotency key.
  refund: '/api/v1/mobile/standalone/refunds',
  expense: '/api/v1/mobile/standalone/expenses',
  collect: '/api/v1/mobile/standalone/collections',
  tillclose: '/api/v1/mobile/standalone/till-closings',
};

/** Events about one sale (a refund, money collected later) need that sale on the server first. */
export const SALE_EVENTS = new Set(['refund', 'collect']);
/** Phone books records: only servers that say `phoneBooksSync` (1.38+) have routes for them. */
export const BOOK_EVENTS = new Set(['refund', 'expense', 'collect', 'tillclose']);

/** What the server wants for each kind. Production is posted straight away; attendance names its branch in the body. */
export function bodyFor(ev, branchId) {
  const body = { ...ev.payload, idempotencyKey: ev.id, deviceId: ev.deviceId };
  if (ev.kind === 'production') body.post = true;
  if (ev.kind === 'transfer' || ev.kind === 'correction') {
    // A stock journal entry: posted straight away, dated when it was done on the phone. The server posts it in one
    // transaction and the key makes a retry return the first result.
    body.type = ev.kind === 'transfer' ? 'TRANSFER' : 'CORRECTION';
    body.occurredAt = ev.payload.occurredAt || ev.createdAt;
    body.post = true;
    delete body.deviceId;
  }
  if (ev.kind in BOOKS) {
    // The books routes are strict: only the fields they know.
    return { idempotencyKey: ev.id, ...BOOKS[ev.kind](ev.payload) };
  }
  if (ev.kind === 'attendance') {
    body.branchId = branchId;
    body.at = ev.payload.at || ev.createdAt;
    delete body.deviceId; // the attendance route does not take one
  }
  return body;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== '').map((k) => [k, o[k]]));
const BOOKS = {
  refund: (p) => pick(p, ['saleId', 'amount', 'method', 'reason']),
  expense: (p) => pick(p, ['spentOn', 'category', 'note', 'amount', 'paidFromCash']),
  collect: (p) => ({ saleId: p.saleId, payments: p.payments.map((x) => pick(x, ['method', 'amount', 'tendered', 'reference'])) }),
  tillclose: (p) => pick(p, ['deviceId', 'deviceName', 'businessDate', 'openingFloat', 'cashSales', 'cashRefunds', 'cashExpenses', 'expectedCash', 'countedCash', 'netSales', 'closedByName', 'closedAt']),
};

/** The person's own shift as the phone knows it: on shift since..., or off. */
export function shiftState(all) {
  const mine = all.filter((e) => e.kind === 'attendance').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const last = mine.find((e) => e.status !== 'failed');
  return last && last.payload.type === 'IN' ? { on: true, since: last.payload.at || last.createdAt } : { on: false };
}

export class AuthExpired extends Error {}
export class DeviceRevoked extends Error {}

/**
 * Send waiting events, oldest first.
 *  2xx          -> synced
 *  400/409/422  -> failed, with the server's words, until someone retries (the server will not change its mind
 *                  by itself: not enough stock, wrong unit...)
 *  401 revoked  -> DeviceRevoked;  401 -> AuthExpired;  403 -> failed (this user may not do it)
 *  5xx/network  -> stays pending, tried again next sync
 */
export async function pushEvents(base, branchId, send, store = events, { hold } = {}) {
  let done = 0;
  let failed = 0;
  let held = 0;
  const waiting = (await store.all()).filter((e) => e.status === 'pending').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const ev of waiting) {
    // Not yet: e.g. a refund on a sale the server does not have yet. Left pending, tried at the next sync.
    if (hold && (await hold(ev))) {
      held++;
      continue;
    }
    const body = bodyFor(ev, branchId);
    let r;
    try {
      r = await send(base, 'POST', `${PATH[ev.kind]}${ev.kind === 'attendance' ? '' : `?branchId=${encodeURIComponent(branchId)}`}`, body);
    } catch {
      break; // offline: keep everything, try again later
    }
    ev.attempts += 1;
    if (r.status === 201 || r.status === 200) {
      ev.status = 'synced';
      ev.syncedAt = new Date().toISOString();
      delete ev.error;
      done++;
    } else if (r.status === 401) {
      if (r.data && r.data.code === 'DEVICE_REVOKED') throw new DeviceRevoked();
      throw new AuthExpired();
    } else if (r.status >= 500 || r.status === 429 || r.status === 0) {
      await store.put(ev);
      break;
    } else {
      ev.status = 'failed';
      ev.error = (r.data && r.data.message) || `The server refused it (${r.status}).`;
      failed++;
    }
    await store.put(ev);
  }
  return { done, failed, held };
}

export async function retryEvent(id, store = events) {
  const ev = await store.get(id);
  if (!ev || ev.status !== 'failed') return false;
  ev.status = 'pending';
  delete ev.error;
  await store.put(ev);
  return true;
}

/** Set a refused record aside (the item was removed, the stock was never there...). It is kept, but no longer nags or sends. */
export async function dismissEvent(id, store = events) {
  const ev = await store.get(id);
  if (!ev || ev.status !== 'failed') return false;
  ev.status = 'dismissed';
  ev.dismissedAt = new Date().toISOString();
  await store.put(ev);
  return true;
}

/** Sent records are only history. Keep the newest `keep` and anything from the last `days`; drop the rest so the phone's storage never fills with them. */
export async function pruneSynced(store = events, { keep = 100, days = 14, now = new Date() } = {}) {
  if (!store.del) return 0;
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const synced = (await store.all()).filter((e) => e.status === 'synced').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const drop = synced.slice(keep).filter((e) => e.createdAt < cutoff);
  for (const e of drop) await store.del(e.id);
  return drop.length;
}

export async function counts(store = events) {
  const all = await store.all();
  return { pending: all.filter((e) => e.status === 'pending').length, failed: all.filter((e) => e.status === 'failed').length };
}
