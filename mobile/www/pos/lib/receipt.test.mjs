import test from 'node:test';
import assert from 'node:assert/strict';
import { escposReceipt, htmlReceipt, columnsFor, toBase64 } from './receipt.js';
import { upiLink } from './bill.js';

const snap = {
  restaurant: { name: 'PKUSS Hotel', currency: 'INR', upiVpa: 'pkuss@upi', upiPayeeName: 'PKUSS Hotel' },
  branch: { name: 'Main', address: '12 MG Road', phone: '9000000000', gstNumber: '19ABCDE1234F1Z5', taxLabel: 'GST', printerPaperWidthMm: 58, printerColumns: null },
};
const sale = {
  localNumber: 'OFF-261102-001', soldAt: '2026-11-02T10:00:00Z', type: 'DINE_IN', tableLabel: 'Table 4',
  items: [{ name: 'Paneer Tikka', price: 280, quantity: 2 }, { name: 'Coca-Cola', price: 90, quantity: 1 }],
  bill: { subtotal: 650, discountAmount: 0, tax: 99.15, total: 650 },
  payments: [{ method: 'CASH', amount: 650, tendered: 700 }], change: 50,
};
const text = (u8) => Buffer.from(u8).toString('latin1');

test('the thermal receipt lists the dishes, totals and change', () => {
  const t = text(escposReceipt(sale, snap));
  assert.match(t, /2 x Paneer Tikka/);
  assert.match(t, /560\.00/);
  assert.match(t, /TOTAL\s+650\.00/);
  assert.match(t, /Change\s+50\.00/);
  assert.match(t, /Thank you/);
});

test('an unpaid bill carries the UPI QR and the amount, a paid one does not', () => {
  const uri = upiLink({ vpa: 'pkuss@upi', name: 'PKUSS Hotel', amount: 650 });
  const bill = text(escposReceipt(sale, snap, { provisional: true, upiUri: uri }));
  assert.ok(bill.includes('upi://pay?pa=pkuss%40upi'));
  assert.match(bill, /Scan to pay by UPI/);
  assert.match(bill, /TOTAL DUE/);
  const paid = text(escposReceipt(sale, snap, { upiUri: uri }));
  assert.ok(!paid.includes('upi://pay'));
});

test('58 mm printers get 32 columns and 80 mm printers 48', () => {
  assert.equal(columnsFor(snap), 32);
  assert.equal(columnsFor({ ...snap, branch: { ...snap.branch, printerPaperWidthMm: 80 } }), 48);
});

test('a long dish name wraps instead of running off the paper', () => {
  const long = { ...sale, items: [{ name: 'Extra Large Special Hyderabadi Dum Chicken Biryani', price: 400, quantity: 1 }] };
  const lines = text(escposReceipt(long, snap)).split('\n');
  assert.ok(lines.every((l) => l.length <= 32 + 12)); // control bytes aside, no line is longer than the paper
});

test('the printable page is escaped and shows the QR on a bill', () => {
  const evil = { ...sale, items: [{ name: '<b>x</b>', price: 10, quantity: 1 }] };
  const html = htmlReceipt(evil, snap, { provisional: true, upiSvg: '<svg id="q"></svg>' });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('<svg id="q">'));
  assert.ok(html.includes('TOTAL DUE'));
});

test('base64 round-trips the printer bytes', () => {
  const bytes = escposReceipt(sale, snap);
  assert.deepEqual(Uint8Array.from(Buffer.from(toBase64(bytes), 'base64')), bytes);
});
