import test from 'node:test';
import assert from 'node:assert/strict';
import { newBooking, clashes, setStatus, grouped, mergeFromServer, toPayload, heldSoon } from './reservations.js';

const b = (id, extra = {}) => ({ ...newBooking({ id, name: 'Asha', guests: 4, at: '2026-11-10T19:00:00Z', tableLabel: 'T1' }), ...extra });

test('a booking needs a name, a sensible party size, a time and a sane stay', () => {
  assert.throws(() => newBooking({ id: 'x', name: ' ', guests: 2, at: '2026-11-10T19:00:00Z' }), /name/);
  assert.throws(() => newBooking({ id: 'x', name: 'A', guests: 0, at: '2026-11-10T19:00:00Z' }), /guests/);
  assert.throws(() => newBooking({ id: 'x', name: 'A', guests: 2, at: 'nope' }), /date/);
  assert.throws(() => newBooking({ id: 'x', name: 'A', guests: 2, at: '2026-11-10T19:00:00Z', duration: 5 }), /Stay/);
  assert.throws(() => newBooking({ id: 'x', name: 'A', guests: 2, at: '2026-11-10T19:00:00Z', phone: 'abc' }), /phone/);
  assert.match(b('1234abcd').id, /^ph_/);
});

test('the same table cannot be held twice at overlapping times, but can after the stay', () => {
  const a = b('a1');
  assert.equal(clashes([a], b('a2', { reservedAt: '2026-11-10T20:00:00Z' })).id, a.id);
  assert.equal(clashes([a], b('a3', { reservedAt: '2026-11-10T20:30:00Z' })), null);
  assert.equal(clashes([a], b('a4', { tableLabel: 'T2' })), null);
  assert.equal(clashes([setStatus(a, 'CANCELLED')], b('a5')), null);
  assert.equal(clashes([a], a), null);
});

test('changing status marks the booking as unsent and stamps the time', () => {
  const s = setStatus({ ...b('a1'), dirty: false }, 'ARRIVED', new Date('2026-11-10T19:05:00Z'));
  assert.equal(s.status, 'ARRIVED');
  assert.equal(s.dirty, true);
  assert.equal(s.updatedAt, '2026-11-10T19:05:00.000Z');
});

test('upcoming lists active bookings from today on, in time order', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const g = grouped([b('l1', { reservedAt: '2026-11-11T10:00:00Z' }), b('l2', { reservedAt: '2026-11-10T18:00:00Z' }), b('l3', { status: 'CANCELLED' })], now);
  assert.deepEqual(g.upcoming.map((x) => x.id), ['ph_l2', 'ph_l1']);
  assert.equal(g.past.length, 1);
});

test('a server copy replaces a sent booking but never overwrites unsent edits', () => {
  const sent = { ...b('s1'), dirty: false };
  const unsent = { ...b('s2'), dirty: true, customerName: 'Edited on phone' };
  const out = mergeFromServer(
    [sent, unsent],
    [{ id: 'ph_s1', mine: true, customerName: 'Changed on server', guestCount: 4, reservedAt: sent.reservedAt, durationMinutes: 90, tableId: 'tid', status: 'CONFIRMED', updatedAt: 'z' }, { id: 'ph_s2', customerName: 'Server', guestCount: 1, reservedAt: sent.reservedAt, durationMinutes: 90, status: 'RESERVED', updatedAt: 'z' }, { id: 'srv1', mine: false, customerName: 'Walk-in web', guestCount: 2, reservedAt: sent.reservedAt, durationMinutes: 90, status: 'RESERVED', updatedAt: 'z' }],
    (id) => (id === 'tid' ? 'T9' : ''),
  );
  const byId = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.equal(byId.ph_s1.customerName, 'Changed on server');
  assert.equal(byId.ph_s1.tableLabel, 'T9');
  assert.equal(byId.ph_s1.dirty, false);
  assert.equal(byId.ph_s2.customerName, 'Edited on phone');
  assert.equal(byId.srv1.customerName, 'Walk-in web');
});

test('the payload sends id for phone bookings and serverId for server ones, with the table matched by name', () => {
  const ids = (l) => (l === 'T1' ? 'tbl-1' : '');
  const mine = toPayload(b('p1'), ids);
  assert.equal(mine.id, 'ph_p1');
  assert.equal(mine.tableId, 'tbl-1');
  assert.equal(mine.serverId, undefined);
  const theirs = toPayload({ ...b('p2'), id: 'srv-abcdefgh', mine: false, tableLabel: 'Gone' }, ids);
  assert.equal(theirs.serverId, 'srv-abcdefgh');
  assert.equal(theirs.id, undefined);
  assert.equal(theirs.tableId, undefined);
});

test('a table shows as held in the hour before a booking and while the guests are seated', () => {
  const x = b('h1');
  assert.equal(heldSoon(x, new Date('2026-11-10T18:30:00Z')), true);
  assert.equal(heldSoon(x, new Date('2026-11-10T16:00:00Z')), false);
  assert.equal(heldSoon(setStatus(x, 'CANCELLED'), new Date('2026-11-10T18:30:00Z')), false);
});
