import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {};
const { serverInfo } = await import('./net.js');

const reply = (status, data) => async () => ({ status, json: async () => data });
const withFetch = async (fn, run) => {
  const old = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    return await run();
  } finally {
    globalThis.fetch = old;
  }
};

test('a current server reports version and capabilities', async () => {
  const f = async (url) =>
    url.endsWith('/server-info')
      ? { status: 200, json: async () => ({ product: 'orderrestro', version: '1.23.0', apiVersion: 2, capabilities: { standaloneSalesSync: true } }) }
      : { status: 404, json: async () => ({}) };
  const i = await withFetch(f, () => serverInfo('http://x'));
  assert.equal(i.version, '1.23.0');
  assert.equal(i.legacy, false);
  assert.equal(i.capabilities.standaloneSalesSync, true);
  assert.ok(i.ms >= 0);
});

test('an older server without server-info is still recognised, flagged legacy', async () => {
  const f = async (url) => (url.endsWith('/setup-status') ? { status: 200, json: async () => ({ isSetup: true }) } : { status: 404, json: async () => ({}) });
  const i = await withFetch(f, () => serverInfo('http://x'));
  assert.equal(i.legacy, true);
  assert.equal(i.apiVersion, 1);
});

test('something that is not OrderRestro, or nothing at all, gives null', async () => {
  assert.equal(await withFetch(reply(200, { hello: 1 }), () => serverInfo('http://x')), null);
  assert.equal(await withFetch(async () => { throw new Error('down'); }, () => serverInfo('http://x')), null);
});
