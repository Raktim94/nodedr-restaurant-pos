import test from 'node:test';
import assert from 'node:assert/strict';
import { newOrder, kotDelta, markSent, tableMap, tableTakenBy, dayReport, saleNote, openOrders, minutesSince } from './orders.js';
import { escposKot, htmlKot } from './kot.js';

const line = (name, qty, extra = {}) => ({ menuItemId: name, name, price: 100, taxRate: 5, qty, sent: 0, note: '', ...extra });
const ord = (id, items, extra = {}) => ({ ...newOrder({ id, number: id, type: 'DINE_IN', tableLabel: 'T1' }), items, ...extra });

test('the kitchen is told only what is new, and what was cancelled after it was sent', () => {
  const o = ord('a', [line('Dal', 2), line('Naan', 3)]);
  let d = kotDelta(o);
  assert.deepEqual(d.add.map((x) => [x.name, x.qty]), [['Dal', 2], ['Naan', 3]]);
  markSent(o, 1);
  assert.equal(kotDelta(o).empty, true);
  o.items[0].qty = 3; // one more dal
  o.items[1].qty = 1; // two naan cancelled
  d = kotDelta(o);
  assert.deepEqual(d.add.map((x) => [x.name, x.qty]), [['Dal', 1]]);
  assert.deepEqual(d.cancel.map((x) => [x.name, x.qty]), [['Naan', 2]]);
  assert.deepEqual(o.kotNumbers, [1]);
});

test('a table with an open order is occupied; a second order on it is a conflict', () => {
  const a = ord('a', [line('Dal', 1)]);
  const paid = ord('b', [line('Dal', 1)], { status: 'PAID' });
  const empty = ord('c', [], { tableLabel: 'T2' });
  assert.deepEqual([...tableMap([a, paid, empty]).keys()], ['T1']);
  assert.equal(tableTakenBy([a], 'T1', 'zzz').id, 'a');
  assert.equal(tableTakenBy([a], 'T1', 'a'), null); // its own table is not a conflict
  assert.equal(openOrders([empty]).length, 0); // an empty draft holds nothing
});

test('an order that was fully sent then emptied still holds its table until settled', () => {
  const o = ord('a', [line('Dal', 0, { sent: 2 })], { kotNumbers: [4] });
  assert.equal(openOrders([o]).length, 1);
});

test('day report adds up payments, tax, discounts, top dishes and voids for today only', () => {
  const now = new Date('2026-11-08T15:00:00');
  const sale = (soldAt, total, pays, items, status = 'synced') => ({ soldAt, status, bill: { total, tax: 5, discountAmount: 10 }, payments: pays, items });
  const r = dayReport(
    [
      sale('2026-11-08T09:00:00', 200, [{ method: 'CASH', amount: 200 }], [{ name: 'Dal', quantity: 2 }]),
      sale('2026-11-08T12:00:00', 150.5, [{ method: 'UPI', amount: 100 }, { method: 'CASH', amount: 50.5 }], [{ name: 'Dal', quantity: 1 }, { name: 'Naan', quantity: 4 }], 'pending'),
      sale('2026-11-07T12:00:00', 999, [{ method: 'CASH', amount: 999 }], [{ name: 'Old', quantity: 9 }]),
    ],
    [{ status: 'VOID', voidedAt: '2026-11-08T10:00:00', items: [{ price: 40, qty: 2 }] }],
    now,
  );
  assert.equal(r.count, 2);
  assert.equal(r.total, 350.5);
  assert.deepEqual(r.byMethod, { CASH: 250.5, UPI: 100, CARD: 0, OTHER: 0 });
  assert.equal(r.discount, 20);
  assert.deepEqual(r.top, [{ name: 'Naan', qty: 4 }, { name: 'Dal', qty: 3 }]);
  assert.equal(r.notSynced, 1);
  assert.equal(r.voids, 1);
  assert.equal(r.voidValue, 80);
});

test('item notes travel with the sale to the server, capped at its limit', () => {
  assert.equal(saleNote([{ quantity: 2, name: 'Dal', note: 'no onion' }, { quantity: 1, name: 'Rice' }]), 'Notes - 2x Dal: no onion');
  assert.equal(saleNote([{ quantity: 1, name: 'Rice' }]), undefined);
  assert.ok(saleNote([{ quantity: 1, name: 'x', note: 'y'.repeat(500) }]).length <= 300);
});

test('minutesSince never goes negative', () => {
  assert.equal(minutesSince(new Date(Date.now() + 60000).toISOString()), 0);
  assert.equal(minutesSince(new Date(Date.now() - 5 * 60000).toISOString()), 5);
});

const snap = { branch: { printerColumns: 32 } };
const kot = { number: 7, at: '2026-11-08T12:00:00', type: 'DINE_IN', tableLabel: 'T1', orderNumber: 'ORD-1', add: [{ qty: 2, name: 'Paneer Tikka', note: 'no onion' }], cancel: [{ qty: 1, name: 'Naan' }] };
const asText = (b) => String.fromCharCode(...b.filter((c) => c >= 32 && c < 127 || c === 10));

test('the kitchen ticket shows number, table, dishes, notes and cancellations', () => {
  const t = asText(escposKot(kot, snap));
  for (const s of ['KOT 7', 'DINE IN - T1', '2 x', 'Paneer', 'no onion', 'CANCELLED', 'Naan']) assert.ok(t.includes(s), s);
  assert.ok(!t.includes('REPRINT'));
  assert.ok(asText(escposKot({ ...kot, reprint: true }, snap)).includes('REPRINT'));
});

test('the printable kitchen ticket is escaped', () => {
  const h = htmlKot({ ...kot, add: [{ qty: 1, name: '<b>x</b>', note: '' }], cancel: [] });
  assert.ok(h.includes('&lt;b&gt;'));
  assert.ok(!h.includes('<b>x</b>'));
});
