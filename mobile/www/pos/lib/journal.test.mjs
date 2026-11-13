import test from 'node:test';
import assert from 'node:assert/strict';
import { queueEvent, pushEvents, retryEvent, counts, DeviceRevoked, AuthExpired } from './journal.js';

const memory = () => {
  const m = new Map();
  return { put: async (e) => void m.set(e.id, structuredClone(e)), get: async (id) => m.get(id), all: async () => [...m.values()] };
};
const mk = (store, kind = 'waste', at = '2026-11-13T10:00:00Z') => queueEvent(kind, { ingredientId: 'i1', quantity: '1', unit: 'KG', reason: 'SPOILED' }, { userId: 'u', deviceId: 'phone-1234', now: new Date(at), store });

test('an event is on the phone before anything is sent, and carries its own idempotency key', async () => {
  const s = memory();
  const ev = await mk(s);
  assert.equal(ev.status, 'pending');
  assert.ok(ev.id.length >= 8);
  assert.equal((await s.get(ev.id)).payload.reason, 'SPOILED');
});

test('sends oldest first with the key and device id, and marks them synced', async () => {
  const s = memory();
  const b = await mk(s, 'production', '2026-11-13T11:00:00Z');
  const a = await mk(s, 'waste', '2026-11-13T10:00:00Z');
  const sent = [];
  const r = await pushEvents('http://x', 'br1', async (_b, _m, path, body) => (sent.push({ path, body }), { status: 201, data: {} }), s);
  assert.deepEqual(r, { done: 2, failed: 0 });
  assert.match(sent[0].path, /waste\/entries\?branchId=br1/);
  assert.equal(sent[0].body.idempotencyKey, a.id);
  assert.equal(sent[0].body.deviceId, 'phone-1234');
  assert.equal(sent[1].body.post, true); // production is posted, not left as a draft
  assert.equal((await s.get(b.id)).status, 'synced');
});

test('offline or a server error keeps the event for the next sync', async () => {
  const s = memory();
  const e = await mk(s);
  assert.deepEqual(await pushEvents('b', 'x', async () => { throw new Error('offline'); }, s), { done: 0, failed: 0 });
  assert.equal((await s.get(e.id)).status, 'pending');
  await pushEvents('b', 'x', async () => ({ status: 503, data: null }), s);
  assert.equal((await s.get(e.id)).status, 'pending');
});

test('a refusal is kept with the server words, can be retried, and never blocks the others', async () => {
  const s = memory();
  const bad = await mk(s, 'production', '2026-11-13T09:00:00Z');
  const good = await mk(s, 'waste', '2026-11-13T10:00:00Z');
  const r = await pushEvents('b', 'x', async (_b, _m, path) => (path.includes('production') ? { status: 400, data: { message: 'Cannot use 6 KG of Rice, only 2 in stock' } } : { status: 201, data: {} }), s);
  assert.deepEqual(r, { done: 1, failed: 1 });
  assert.equal((await s.get(bad.id)).error, 'Cannot use 6 KG of Rice, only 2 in stock');
  assert.equal((await s.get(good.id)).status, 'synced');
  assert.deepEqual(await counts(s), { pending: 0, failed: 1 });
  assert.equal(await retryEvent(bad.id, s), true);
  assert.deepEqual(await counts(s), { pending: 1, failed: 0 });
  assert.equal(await retryEvent(good.id, s), false); // only failed ones can be retried
});

test('a removed phone and an expired sign-in stop the sync and keep the events', async () => {
  const s = memory();
  const e = await mk(s);
  await assert.rejects(pushEvents('b', 'x', async () => ({ status: 401, data: { code: 'DEVICE_REVOKED' } }), s), DeviceRevoked);
  await assert.rejects(pushEvents('b', 'x', async () => ({ status: 401, data: {} }), s), AuthExpired);
  assert.equal((await s.get(e.id)).status, 'pending');
});

import { bodyFor, shiftState } from './journal.js';

test('attendance is sent with the time it really happened and the branch in the body', async () => {
  const s = memory();
  const e = await queueEvent('attendance', { type: 'IN', at: '2026-11-13T04:00:00.000Z' }, { userId: 'u', deviceId: 'phone-1234', store: s });
  const b = bodyFor(e, 'br1');
  assert.equal(b.type, 'IN');
  assert.equal(b.at, '2026-11-13T04:00:00.000Z');
  assert.equal(b.branchId, 'br1');
  assert.equal(b.idempotencyKey, e.id);
  const sent = [];
  await pushEvents('b', 'br1', async (_b, _m, path, body) => (sent.push({ path, body }), { status: 201, data: {} }), s);
  assert.equal(sent[0].path, '/api/v1/attendance/events'); // no ?branchId on this route
});

test('a stock receipt goes to the journal receipts route with its key', async () => {
  const s = memory();
  const e = await queueEvent('receipt', { ingredientId: 'i1', quantity: '25', unit: 'KG', reference: 'INV-9' }, { userId: 'u', deviceId: 'phone-1234', store: s });
  const sent = [];
  await pushEvents('b', 'br1', async (_b, _m, path, body) => (sent.push({ path, body }), { status: 201, data: {} }), s);
  assert.match(sent[0].path, /inventory\/journal\/receipts\?branchId=br1/);
  assert.equal(sent[0].body.idempotencyKey, e.id);
});

test('the phone knows whether this person is on shift, from what it has recorded', async () => {
  const s = memory();
  assert.deepEqual(shiftState(await s.all()), { on: false });
  await queueEvent('attendance', { type: 'IN', at: '2026-11-13T04:00:00.000Z' }, { userId: 'u', deviceId: 'phone-1234', now: new Date('2026-11-13T04:00:00Z'), store: s });
  assert.equal(shiftState(await s.all()).on, true);
  await queueEvent('attendance', { type: 'OUT', at: '2026-11-13T12:00:00.000Z' }, { userId: 'u', deviceId: 'phone-1234', now: new Date('2026-11-13T12:00:00Z'), store: s });
  assert.equal(shiftState(await s.all()).on, false);
});

test('a clash (already clocked in) is kept for the person to read, with the server words', async () => {
  const s = memory();
  const e = await queueEvent('attendance', { type: 'IN', at: '2026-11-13T04:00:00.000Z' }, { userId: 'u', deviceId: 'phone-1234', store: s });
  await pushEvents('b', 'br1', async () => ({ status: 409, data: { message: 'Already clocked in since 2026-11-13T03:00:00.000Z' } }), s);
  const got = await s.get(e.id);
  assert.equal(got.status, 'failed');
  assert.match(got.error, /Already clocked in/);
  assert.equal(shiftState(await s.all()).on, false); // a refused clock-in does not count as being on shift
});
