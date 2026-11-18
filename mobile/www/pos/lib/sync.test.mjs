import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {};
const { applySyncResult } = await import('./sync.js');

const sale = (over = {}) => ({
  id: 's1',
  status: 'pending',
  collections: [{ id: 'c1', amount: 100 }],
  ...over,
});

test('a collection taken while syncing survives the sync result', () => {
  const sent = sale();
  const fresh = sale({ collections: [{ id: 'c1', amount: 100 }, { id: 'c2', amount: 50 }] });
  const merged = applySyncResult(sent, fresh, { status: 'ok', orderId: 'o1', orderNumber: 'A-1' });
  assert.equal(merged.status, 'synced');
  assert.equal(merged.serverOrderId, 'o1');
  assert.deepEqual(
    merged.collections.map((c) => [c.id, c.amount, !!c.sentWithSale]),
    [
      ['c1', 100, true],
      ['c2', 50, false],
    ],
  );
});

test('a sale set aside while syncing is not silently reopened', () => {
  const sent = sale();
  const fresh = sale({ status: 'dismissed', dismissedAt: '2026-11-18T10:00:00Z' });
  const merged = applySyncResult(sent, fresh, { status: 'ok', orderId: 'o1', orderNumber: 'A-1' });
  assert.equal(merged.status, 'dismissed');
  assert.equal(merged.serverOrderId, 'o1');
  assert.equal(merged.dismissedAt, '2026-11-18T10:00:00Z');
});

test('a duplicate response only acknowledges collections from the original payload', () => {
  const sent = {
    ...sale(),
    syncPayloadCollections: ['c1'],
    collections: [{ id: 'c1', amount: 100 }, { id: 'c2', amount: 50 }],
  };
  const fresh = {
    ...sent,
    collections: [{ id: 'c1', amount: 100 }, { id: 'c2', amount: 50 }],
    status: 'pending',
  };
  const merged = applySyncResult(sent, fresh, {
    status: 'duplicate',
    orderId: 'o1',
    orderNumber: 'A-1',
  });
  assert.equal(merged.status, 'synced');
  assert.deepEqual(
    merged.collections.map((c) => [c.id, !!c.sentWithSale]),
    [['c1', true], ['c2', false]],
  );
});

test('a refused sale keeps newer collections and records the reason', () => {
  const sent = sale();
  const fresh = sale({ collections: [{ id: 'c1', amount: 100 }, { id: 'c2', amount: 25 }] });
  const merged = applySyncResult(sent, fresh, { status: 'refused', reason: 'Dish unavailable', code: 'ITEM_UNAVAILABLE' });
  assert.equal(merged.status, 'refused');
  assert.equal(merged.refusedCode, 'ITEM_UNAVAILABLE');
  assert.equal(merged.collections.length, 2);
  assert.equal(merged.collections[1].amount, 25);
});
