import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefund, refundableLines, refundedTotal, buildExpense, dayBooks, rangeBooks, closeDay, salesCsv, cell, backupJson, parseBackup, today } from './books.js';

const NOW = new Date('2026-11-08T12:00:00');
const sale = (extra = {}) => ({
  id: 's1', localNumber: 'OFF-261108-001', soldAt: '2026-11-08T10:00:00', type: 'TAKEAWAY', tableLabel: '', status: 'pending',
  items: [{ menuItemId: 'a', name: 'Dal', price: 100, taxRate: 5, quantity: 2 }, { menuItemId: 'b', name: 'Naan', price: 50, taxRate: 5, quantity: 2 }],
  bill: { subtotal: 300, discountAmount: 0, tax: 14.29, total: 300 },
  payments: [{ method: 'CASH', amount: 300 }], change: 0, ...extra,
});

test('partial refund pays back the price of the chosen dish', () => {
  const r = buildRefund({ id: 'r1', sale: sale(), refunds: [], picks: [{ index: 0, qty: 1 }], now: NOW });
  assert.equal(r.amount, 100);
  assert.equal(r.lines[0].name, 'Dal');
});

test('a discounted bill refunds the discounted amount, never more than was paid', () => {
  const s = sale({ bill: { subtotal: 300, discountAmount: 30, tax: 12.86, total: 270 } });
  const all = buildRefund({ id: 'r', sale: s, refunds: [], picks: [{ index: 0, qty: 2 }, { index: 1, qty: 2 }], now: NOW });
  assert.equal(all.amount, 270);
  const one = buildRefund({ id: 'r', sale: s, refunds: [], picks: [{ index: 0, qty: 1 }], now: NOW });
  assert.equal(one.amount, 90);
});

test('refunding in pieces adds up to exactly what was paid, and not a paisa more', () => {
  const s = sale({ items: [{ menuItemId: 'a', name: 'Tea', price: 33.33, taxRate: 0, quantity: 3 }], bill: { subtotal: 99.99, discountAmount: 0, tax: 0, total: 99.99 } });
  const refunds = [];
  for (let i = 0; i < 3; i++) refunds.push(buildRefund({ id: `r${i}`, sale: s, refunds, picks: [{ index: 0, qty: 1 }], now: NOW }));
  assert.equal(refundedTotal(s, refunds), 99.99);
  assert.throws(() => buildRefund({ id: 'x', sale: s, refunds, picks: [{ index: 0, qty: 1 }] }), /Only 0 of Tea/);
});

test('cannot refund more than was sold, or nothing', () => {
  assert.throws(() => buildRefund({ id: 'r', sale: sale(), refunds: [], picks: [{ index: 0, qty: 3 }] }), /Only 2 of Dal/);
  assert.throws(() => buildRefund({ id: 'r', sale: sale(), refunds: [], picks: [{ index: 0, qty: 0 }] }), /at least one/);
  const first = buildRefund({ id: 'r1', sale: sale(), refunds: [], picks: [{ index: 0, qty: 2 }], now: NOW });
  assert.deepEqual(refundableLines(sale(), [first]).map((l) => l.left), [0, 2]);
});

test('exclusive-tax sale shares the total by tax-inclusive price', () => {
  const s = sale({ taxMode: 'EXCLUSIVE', items: [{ menuItemId: 'a', name: 'A', price: 100, taxRate: 18, quantity: 1 }, { menuItemId: 'b', name: 'B', price: 100, taxRate: 0, quantity: 1 }], bill: { subtotal: 218, discountAmount: 0, tax: 18, total: 218 } });
  assert.equal(buildRefund({ id: 'r', sale: s, refunds: [], picks: [{ index: 0, qty: 1 }] }).amount, 118);
});

test('expense needs an amount and a reason', () => {
  assert.throws(() => buildExpense({ id: 'e', amount: 0, note: 'x' }), /amount/);
  assert.throws(() => buildExpense({ id: 'e', amount: 10, note: ' ' }), /what it was for/i);
  assert.equal(buildExpense({ id: 'e', amount: '250.456', note: 'Veg', now: NOW }).amount, 250.46);
});

test('the cash drawer: float + cash sales - cash refunds - cash expenses', () => {
  const sales = [sale(), sale({ id: 's2', bill: { subtotal: 200, discountAmount: 0, tax: 9, total: 200 }, payments: [{ method: 'UPI', amount: 200 }] }), sale({ id: 'old', soldAt: '2026-11-07T10:00:00' })];
  const refunds = [{ id: 'r', saleId: 's1', at: '2026-11-08T11:00:00', amount: 100, tax: 4, method: 'CASH', lines: [] }];
  const expenses = [{ id: 'e', at: '2026-11-08T09:00:00', amount: 40, method: 'CASH' }, { id: 'e2', at: '2026-11-08T09:30:00', amount: 60, method: 'OTHER' }];
  const b = dayBooks({ sales, refunds, expenses, float: 500, day: '2026-11-08' });
  assert.equal(b.sales, 2);
  assert.equal(b.gross, 500);
  assert.equal(b.net, 400);
  assert.equal(b.expenseTotal, 100);
  assert.equal(b.profit, 300);
  assert.equal(b.expectedCash, 500 + 300 - 100 - 40);
  const c = closeDay({ books: b, counted: 650, now: NOW });
  assert.equal(c.difference, 650 - 660);
  assert.throws(() => closeDay({ books: b, counted: 'abc' }), /counted/);
});

test('range report totals and top dishes', () => {
  const r = rangeBooks({ sales: [sale(), sale({ id: 's3', soldAt: '2026-11-01T10:00:00' })], refunds: [], expenses: [], from: '2026-11-08', to: '2026-11-08' });
  assert.equal(r.sales, 1);
  assert.deepEqual(r.top[0], { name: 'Dal', qty: 2 });
});

test('csv cells are quoted and cannot start a spreadsheet formula', () => {
  assert.equal(cell('a,b'), '"a,b"');
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  assert.equal(cell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(cell(-5), '-5');
  const csv = salesCsv([sale({ tableLabel: '=HYPERLINK("x")' })]);
  assert.match(csv, /"'=HYPERLINK/);
  assert.ok(csv.endsWith('\r\n'));
});

test('backup round trip and refusal of foreign files', () => {
  const snap = { local: true, items: [] };
  const back = parseBackup(backupJson({ snapshot: snap, sales: [sale()], expenses: [] }, NOW));
  assert.equal(back.sales.length, 1);
  assert.deepEqual(back.refunds, []);
  assert.throws(() => parseBackup('nope'), /not an OrderRestro backup/);
  assert.throws(() => parseBackup('{"format":"x"}'), /not an OrderRestro backup/);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'orderrestro-standalone-backup', version: 2, snapshot: snap })), /newer version/);
  assert.equal(today(NOW), '2026-11-08');
});
