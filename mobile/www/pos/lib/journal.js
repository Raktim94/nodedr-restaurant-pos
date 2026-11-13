// Production and waste taken in the kitchen, kept on the phone until the server has them.
// Each event has its own id, which is also the idempotency key the server uses, so sending one twice
// (a dropped connection, a retry after a crash) never changes stock twice.
import { events } from './store.js';

export const newId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `ev-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Save an event. It is on disk before anything is sent. */
export async function queueEvent(kind, payload, { userId, deviceId, now = new Date(), store = events } = {}) {
  const ev = {
    id: `${deviceId || 'dev'}-${newId()}`, // >= 8 chars, unique per event
    kind, // 'production' | 'waste' | 'receipt'
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
};

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
export async function pushEvents(base, branchId, send, store = events) {
  let done = 0;
  let failed = 0;
  const waiting = (await store.all()).filter((e) => e.status === 'pending').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const ev of waiting) {
    const body = { ...ev.payload, idempotencyKey: ev.id, deviceId: ev.deviceId };
    if (ev.kind === 'production') body.post = true;
    let r;
    try {
      r = await send(base, 'POST', `${PATH[ev.kind]}?branchId=${encodeURIComponent(branchId)}`, body);
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
  return { done, failed };
}

export async function retryEvent(id, store = events) {
  const ev = await store.get(id);
  if (!ev || ev.status !== 'failed') return false;
  ev.status = 'pending';
  delete ev.error;
  await store.put(ev);
  return true;
}

export async function counts(store = events) {
  const all = await store.all();
  return { pending: all.filter((e) => e.status === 'pending').length, failed: all.filter((e) => e.status === 'failed').length };
}
