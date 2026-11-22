import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { olderThan } = createRequire(import.meta.url)('./server.js');

test('compares x.y.z numerically, not as text', () => {
  assert.equal(olderThan('1.9.2', '1.10.0'), true);
  assert.equal(olderThan('1.10.0', '1.9.2'), false);
  assert.equal(olderThan('1.30.9', '1.31.0'), true);
  assert.equal(olderThan('1.31.0', '1.31.0'), false);
  assert.equal(olderThan('2.0.0', '1.99.99'), false);
});
test('a tag that is not plain x.y.z is never "older"', () => {
  assert.equal(olderThan('latest', '1.0.0'), false);
  assert.equal(olderThan('1.0.0', 'latest'), false);
});
