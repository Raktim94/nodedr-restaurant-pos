import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, settle, upiLink, round2 } from './bill.js';

test('prices are tax-inclusive: the tax is backed out, never added', () => {
  const b = computeBill([{ price: 118, quantity: 1, taxRate: 18 }]);
  assert.equal(b.total, 118);
  assert.equal(b.tax, 18);
});

test('exclusive branches gross the price up first', () => {
  const b = computeBill([{ price: 100, quantity: 2, taxRate: 10 }], { taxMode: 'EXCLUSIVE' });
  assert.equal(b.total, 220);
  assert.equal(b.tax, 20);
});

test('a percent discount cuts the price and the tax pro-rata', () => {
  const b = computeBill([{ price: 200, quantity: 1, taxRate: 18 }], { discountPercent: 10 });
  assert.equal(b.discountAmount, 20);
  assert.equal(b.total, 180);
  assert.equal(b.tax, round2(30.51 * 0.9));
});

test('a flat discount can never exceed the bill', () => {
  const b = computeBill([{ price: 50, quantity: 1, taxRate: 0 }], { discountFlat: 500 });
  assert.equal(b.total, 0);
  assert.equal(b.discountAmount, 50);
});

test('cash above the total is change, recorded with what was handed over', () => {
  const s = settle(154, [{ method: 'CASH', amount: 200 }]);
  assert.deepEqual(s.rows, [{ method: 'CASH', amount: 154, tendered: 200 }]);
  assert.equal(s.change, 46);
  assert.equal(s.fullyPaid, true);
});

test('a split between UPI and cash adds up', () => {
  const s = settle(100, [{ method: 'UPI', amount: 60, reference: 'T1' }, { method: 'CASH', amount: 50 }]);
  assert.equal(s.fullyPaid, true);
  assert.equal(s.rows[0].amount, 60);
  assert.deepEqual(s.rows[1], { method: 'CASH', amount: 40, tendered: 50 });
  assert.equal(s.change, 10);
});

test('a short payment is not fully paid', () => {
  const s = settle(100, [{ method: 'CARD', amount: 40 }]);
  assert.equal(s.fullyPaid, false);
  assert.equal(s.balance, 60);
});

test('the UPI link matches the server format', () => {
  assert.equal(
    upiLink({ vpa: 'shop@upi', name: 'My Shop', amount: 12.5, note: 'Order 1' }),
    'upi://pay?pa=shop%40upi&pn=My%20Shop&am=12.50&cu=INR&tn=Order%201',
  );
});
