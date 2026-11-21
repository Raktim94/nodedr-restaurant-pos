import test from 'node:test';
import assert from 'node:assert/strict';
import { planTables } from './tables.js';

test('makes numbered tables from a prefix and start number', () => {
  assert.deepEqual(planTables({ prefix: 'T', from: 1, count: 4 }), ['T1', 'T2', 'T3', 'T4']);
  assert.deepEqual(planTables({ prefix: 'Garden ', from: 5, count: 2 }), ['Garden5', 'Garden6']);
  assert.deepEqual(planTables({ prefix: '', from: 1, count: 3 }), ['1', '2', '3']);
});

test('refuses a clash with an existing table (any letter case) and creates nothing', () => {
  assert.throws(() => planTables({ existing: ['t3'], prefix: 'T', from: 1, count: 5 }), /T3 already exists/);
});

test('rejects bad numbers', () => {
  assert.throws(() => planTables({ count: 0 }), /1 to 100/);
  assert.throws(() => planTables({ count: 101 }), /1 to 100/);
  assert.throws(() => planTables({ from: -1 }), /Start number/);
  assert.throws(() => planTables({ count: 2.5 }), /whole number/);
});
