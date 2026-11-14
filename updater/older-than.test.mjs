// The updater is a script that starts a server on load, so the comparison is read out of the source and tested alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
const olderThan = new Function(src.match(/const VERSION_RE[\s\S]*?\n}\n/)[0] + '; return olderThan;')();

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
