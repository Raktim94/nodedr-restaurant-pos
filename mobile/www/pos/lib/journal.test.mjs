import test from 'node:test';
import assert from 'node:assert/strict';
import { queueEvent, pushEvents, retryEvent, dismissEvent, pruneSynced, counts, DeviceRevoked, AuthExpired } from './journal.js';

const memory = () => {
  const m = new Map();
  return { put: async (e) => void m.set(e.id, structuredClone(e)), get: async (id) => m.get(id), del: async (id) => void m.delete(id), all: async () => [...m.values()] };
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
  assert.deepEqual(r, { done: 2, failed: 0, held: 0 });
  assert.match(sent[0].path, /waste\/entries\?branchId=br1/);
  assert.equal(sent[0].body.idempotencyKey, a.id);
  assert.equal(sent[0].body.deviceId, 'phone-1234');
  assert.equal(sent[1].body.post, true); // production is posted, not left as a draft
  assert.equal((await s.get(b.id)).status, 'synced');
});

test('offline or a server error keeps the event for the next sync', async () => {
  const s = memory();
  const e = await mk(s);
  assert.deepEqual(await pushEvents('b', 'x', async () => { throw new Error('offline'); }, s), { done: 0, failed: 0, held: 0 });
  assert.equal((await s.get(e.id)).status, 'pending');
  await pushEvents('b', 'x', async () => ({ status: 503, data: null }), s);
  assert.equal((await s.get(e.id)).status, 'pending');
});

test('a refusal is kept with the server words, can be retried, and never blocks the others', async () => {
  const s = memory();
  const bad = await mk(s, 'production', '2026-11-13T09:00:00Z');
  const good = await mk(s, 'waste', '2026-11-13T10:00:00Z');
  const r = await pushEvents('b', 'x', async (_b, _m, path) => (path.includes('production') ? { status: 400, data: { message: 'Cannot use 6 KG of Rice, only 2 in stock' } } : { status: 201, data: {} }), s);
  assert.deepEqual(r, { done: 1, failed: 1, held: 0 });
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

test('a transfer and a correction go to the stock journal as posted entries with their own key and time', async () => {
  const s = memory();
  const t = await queueEvent('transfer', { reason: 'Dinner prep', lines: [{ ingredientId: 'i1', quantity: '2', unit: 'KG', fromLocationId: 'a', toLocationId: 'b' }] }, { userId: 'u', deviceId: 'phone-1234', now: new Date('2026-11-15T10:00:00Z'), store: s });
  const c = await queueEvent('correction', { reason: 'Count', lines: [{ ingredientId: 'i1', quantity: '1', unit: 'KG', direction: 'OUT' }] }, { userId: 'u', deviceId: 'phone-1234', now: new Date('2026-11-15T11:00:00Z'), store: s });
  const sent = [];
  const r = await pushEvents('http://x', 'br1', async (_b, _m, path, body) => (sent.push({ path, body }), { status: 201, data: {} }), s);
  assert.deepEqual(r, { done: 2, failed: 0, held: 0 });
  assert.match(sent[0].path, /journal\/entries\?branchId=br1/);
  assert.equal(sent[0].body.type, 'TRANSFER');
  assert.equal(sent[0].body.post, true);
  assert.equal(sent[0].body.idempotencyKey, t.id);
  assert.equal(sent[0].body.occurredAt, '2026-11-15T10:00:00.000Z');
  assert.equal('deviceId' in sent[0].body, false);
  assert.equal(sent[1].body.type, 'CORRECTION');
  assert.equal(sent[1].body.idempotencyKey, c.id);
});

test('a refused transfer keeps the server words so the person can fix it', async () => {
  const s = memory();
  const t = await queueEvent('transfer', { lines: [] }, { userId: 'u', deviceId: 'phone-1234', store: s });
  await pushEvents('b', 'x', async () => ({ status: 400, data: { message: 'Only 1 KG of Rice is recorded in Dry store.' } }), s);
  assert.equal((await s.get(t.id)).error, 'Only 1 KG of Rice is recorded in Dry store.');
});

test('a refused record can be set aside: it stops counting and is never sent again', async () => {
  const s = memory();
  const e = await mk(s);
  await pushEvents('b', 'x', async () => ({ status: 400, data: { message: 'Item was removed' } }), s);
  assert.deepEqual(await counts(s), { pending: 0, failed: 1 });
  assert.equal(await dismissEvent(e.id, s), true);
  assert.deepEqual(await counts(s), { pending: 0, failed: 0 });
  assert.equal((await s.get(e.id)).status, 'dismissed');
  let sent = 0;
  await pushEvents('b', 'x', async () => (sent++, { status: 201, data: {} }), s);
  assert.equal(sent, 0);
  assert.equal(await dismissEvent(e.id, s), false); // only failed ones
  assert.equal(await retryEvent(e.id, s), false);
});

test('old sent records are pruned but waiting, refused and recent ones never are', async () => {
  const s = memory();
  const now = new Date('2026-12-30T00:00:00Z');
  const old = await mk(s, 'waste', '2026-10-01T00:00:00Z');
  const recent = await mk(s, 'waste', '2026-12-29T00:00:00Z');
  const waiting = await mk(s, 'waste', '2026-10-02T00:00:00Z');
  for (const e of [old, recent]) await s.put({ ...(await s.get(e.id)), status: 'synced' });
  assert.equal(await pruneSynced(s, { keep: 0, days: 14, now }), 1);
  assert.equal(await s.get(old.id), undefined);
  assert.ok(await s.get(recent.id));
  assert.ok(await s.get(waiting.id)); // still pending: never dropped
});

test('the phone books go to their routes with only the fields the server takes', async () => {
  const s = memory();
  const at = { userId: 'u', deviceId: 'phone-1234', store: s };
  await queueEvent('expense', { spentOn: '2026-11-15', note: 'Gas', category: '', amount: 900, paidFromCash: true, localId: 'x' }, at);
  await queueEvent('tillclose', { deviceId: 'phone-1234', businessDate: '2026-11-15', openingFloat: 0, cashSales: 10, cashRefunds: 0, cashExpenses: 0, expectedCash: 10, countedCash: 10, netSales: 10, closedAt: '2026-11-15T20:00:00Z', extra: 1 }, at);
  const sent = [];
  await pushEvents('http://x', 'br1', async (_b, _m, path, body) => (sent.push({ path, body }), { status: 201, data: {} }), s);
  const exp = sent.find((x) => /expenses/.test(x.path));
  assert.match(exp.path, /\/mobile\/standalone\/expenses\?branchId=br1$/);
  assert.deepEqual(Object.keys(exp.body).sort(), ['amount', 'idempotencyKey', 'note', 'paidFromCash', 'spentOn']);
  const till = sent.find((x) => /till-closings/.test(x.path));
  assert.equal(till.body.extra, undefined);
  assert.equal(till.body.countedCash, 10);
});

test('a refund waits (still pending) while its sale is not on the server, then goes', async () => {
  const s = memory();
  const ev = await queueEvent('refund', { saleId: 'sale-0001', amount: 50, method: 'CASH' }, { userId: 'u', deviceId: 'phone-1234', store: s });
  const send = async () => ({ status: 201, data: {} });
  let r = await pushEvents('http://x', 'br1', send, s, { hold: async (e) => e.payload.saleId === 'sale-0001' });
  assert.deepEqual(r, { done: 0, failed: 0, held: 1 });
  assert.equal((await s.get(ev.id)).status, 'pending');
  r = await pushEvents('http://x', 'br1', send, s, { hold: async () => false });
  assert.equal(r.done, 1);
});
