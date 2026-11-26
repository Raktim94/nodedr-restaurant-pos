import assert from 'node:assert/strict';
import test from 'node:test';
import { activePauseUntil, mergeMenuPauses, pausedAddition } from './menu-pause.js';

const until = '2026-11-25T16:10:00.000Z';
const lasagna = { id: 'lasagna', pausedUntil: until };
const before = Date.parse(until) - 1;

test('a cached pause expires at its exact deadline even when the phone is offline', () => {
  assert.equal(activePauseUntil(lasagna, before), Date.parse(until));
  assert.equal(activePauseUntil(lasagna, Date.parse(until)), null);
  assert.equal(activePauseUntil({ id: 'older-snapshot' }, before), null);
});

test('a pause blocks new quantities and lets the cashier settle or reduce a sent order', () => {
  const line = { item: { id: 'lasagna' }, qty: 2, sent: 1 };
  assert.equal(pausedAddition([lasagna], [line], before), lasagna);
  assert.equal(pausedAddition([lasagna], [{ ...line, qty: 1 }], before), undefined);
  assert.equal(pausedAddition([lasagna], [{ ...line, qty: 0 }], before), undefined);
  assert.equal(pausedAddition([{ ...lasagna, pausedUntil: null }], [line], before), undefined);
});

test('a pause update merges only deadlines, including early resumes, for the same linked menu', () => {
  const snap = { generatedAt: 'v1', branch: { id: 'br1' }, user: { id: 'u1' }, items: [lasagna, { id: 'soup', price: 20, pausedUntil: null }] };
  const rows = [{ id: 'soup', pausedUntil: until }];
  const updated = mergeMenuPauses(snap, snap, rows);
  assert.deepEqual(updated.items, [{ id: 'lasagna', pausedUntil: null }, { id: 'soup', price: 20, pausedUntil: until }]);
  assert.equal(mergeMenuPauses(updated, snap, rows), updated);
  for (const current of [null, { ...snap, local: true }, { ...snap, generatedAt: 'v2' }, { ...snap, branch: { id: 'br2' } }, { ...snap, user: { id: 'u2' } }]) {
    assert.equal(mergeMenuPauses(current, snap, rows), current);
  }
});
