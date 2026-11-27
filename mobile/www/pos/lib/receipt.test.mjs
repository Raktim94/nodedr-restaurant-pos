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
  const t = text(escposReceipt(sale, snap, { locale: 'en-IN' }));
  assert.match(t, /2 x Paneer Tikka/);
  assert.match(t, /560\.00/);
  assert.match(t, /TOTAL\s+INR 650\.00/);
  assert.match(t, /Change\s+INR 50\.00/);
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

test('Brazilian receipts use the configured currency and device locale, including on ASCII printers', () => {
  const brazil = { ...snap, restaurant: { ...snap.restaurant, currency: 'BRL' } };
  const opts = { provisional: true, locale: 'pt-BR', upiUri: 'upi://pay?cu=INR', upiSvg: '<svg id="upi"></svg>' };
  const html = htmlReceipt(sale, brazil, opts);
  assert.match(html, /R\$\s650,00/);
  assert.doesNotMatch(html, /Scan to pay|id="upi"/);
  const thermal = text(escposReceipt(sale, brazil, opts));
  assert.match(thermal, /BRL/);
  assert.match(thermal, /650,00/);
  assert.doesNotMatch(thermal, /upi:\/\/pay/);
  assert.match(htmlReceipt({ ...sale, currency: 'EUR' }, brazil, opts), /€\s650,00/);
  const legacy = { ...brazil, restaurant: { ...brazil.restaurant, legacySaleCurrency: 'USD' } };
  assert.match(htmlReceipt(sale, legacy, opts), /US\$\s650,00/);
});

test('receipts print the business date when the till is already on the following day', () => {
  const ny = { ...snap, restaurant: { ...snap.restaurant, timezone: 'America/New_York' } };
  const midnight = { ...sale, soldAt: '2026-03-09T03:50:00Z' };
  assert.match(htmlReceipt(midnight, ny, { locale: 'en-GB' }), /08\/03\/2026, 23:50/);
  assert.match(text(escposReceipt(midnight, ny, { locale: 'en-GB' })), /08\/03\/2026, 23:50/);
});
