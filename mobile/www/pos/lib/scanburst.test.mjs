import test from 'node:test';
import assert from 'node:assert/strict';
import { pushKey } from './scanburst.js';
import { findByCode } from './options.js';

function type(text, gap, end = 'Enter') {
  let buf = { text: '', last: 0 };
  let t = 1000;
  for (const ch of text) ({ buf } = pushKey(buf, ch, (t += gap)));
  return pushKey(buf, end, (t += gap)).code;
}

test('a fast burst ending in Enter or Tab is a scan', () => {
  assert.equal(type('8901234567890', 10), '8901234567890');
  assert.equal(type('8901234567890', 10, 'Tab'), '8901234567890');
});

test('slow typing and too-short input are not scans', () => {
  assert.equal(type('8901234567890', 300), undefined);
  assert.equal(type('12', 10), undefined);
});

test('modifier keys do not break a burst', () => {
  let buf = { text: '', last: 0 };
  let t = 1000;
  for (const k of ['1', 'Shift', '2', '3', '4']) ({ buf } = pushKey(buf, k, (t += 10)));
  assert.equal(pushKey(buf, 'Enter', t + 10).code, '1234');
});

test('findByCode tolerates scanner noise and letter case', () => {
  const items = [{ id: 'a', barcode: 'ABC123', sku: null }, { id: 'b', barcode: null, sku: 'cola-5' }];
  assert.equal(findByCode(items, ' abc123\r\n').id, 'a');
  assert.equal(findByCode(items, 'COLA-5').id, 'b');
  assert.equal(findByCode(items, 'zzz'), null);
});
