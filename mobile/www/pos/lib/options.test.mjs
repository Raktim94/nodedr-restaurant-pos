import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChoice, defaultPicks, findByCode, lineKey, needsChoice } from './options.js';
import { computeBill } from './bill.js';

const pizza = {
  id: 'p', name: 'Pizza', price: 300, halfPrice: 180, taxRate: 5,
  options: [
    { id: 'crust', name: 'Crust', min: 1, max: 1, choices: [{ id: 'thin', name: 'Thin', price: 0, isDefault: true }, { id: 'thick', name: 'Thick', price: 20 }] },
    { id: 'extra', name: 'Extras', min: 0, max: 2, choices: [{ id: 'cheese', name: 'Cheese', price: 40 }, { id: 'olive', name: 'Olives', price: 25 }, { id: 'corn', name: 'Corn', price: 15 }] },
  ],
};

test('add-ons in any order are the same line', () => {
  assert.equal(lineKey('p', 'HALF', ['b', 'a']), lineKey('p', 'HALF', ['a', 'b']));
  assert.notEqual(lineKey('p', 'HALF', []), lineKey('p', '', []));
});

test('a half pizza with thick crust and cheese is priced from the half price', () => {
  const r = buildChoice(pizza, { portion: 'HALF', chosen: { crust: ['thick'], extra: ['cheese'] } });
  assert.equal(r.ok, true);
  assert.equal(r.line.item.price, 240);
  assert.equal(r.line.item.name, 'Pizza (Half) + Thick, Cheese');
  assert.equal(r.line.portion, 'HALF');
  assert.deepEqual(r.line.mods.map((m) => m.id), ['thick', 'cheese']);
});

test('a required group must be chosen and a group cannot take more than its max', () => {
  const r = buildChoice(pizza, { portion: 'FULL', chosen: { crust: [], extra: ['cheese', 'olive', 'corn'] } });
  assert.equal(r.ok, false);
  assert.match(r.errors.crust, /Choose one crust/);
  assert.match(r.errors.extra, /at most 2/);
});

test('defaults: full portion and the default crust', () => {
  assert.deepEqual(defaultPicks(pizza), { portion: 'FULL', chosen: { crust: ['thin'], extra: [] } });
  assert.equal(needsChoice(pizza), true);
  assert.equal(needsChoice({ price: 20 }), false);
});

test('a dish without half price has no portion in its key or name', () => {
  const r = buildChoice({ id: 't', name: 'Tea', price: 20, taxRate: 0, options: [] }, {});
  assert.equal(r.line.item.name, 'Tea');
  assert.equal(r.line.key, 't||');
  assert.equal(r.line.portion, undefined);
});

test('barcode and SKU find the dish exactly', () => {
  const items = [{ id: 'a', barcode: '8901234', sku: 'COKE-500' }, { id: 'b' }];
  assert.equal(findByCode(items, ' 8901234 ').id, 'a');
  assert.equal(findByCode(items, 'coke-500').id, 'a');
  assert.equal(findByCode(items, '89012'), null);
});

test('a voluntary service charge is added after the discount and is not taxed', () => {
  const b = computeBill([{ price: 1000, quantity: 1, taxRate: 5 }], { discountPercent: 10, serviceChargePct: 5 });
  assert.equal(b.discountAmount, 100);
  assert.equal(b.serviceCharge, 45);
  assert.equal(b.total, 945);
  assert.equal(b.tax, Math.round(47.62 * 0.9 * 100) / 100);
  assert.equal(computeBill([{ price: 100, quantity: 1, taxRate: 0 }]).serviceCharge, 0);
});
