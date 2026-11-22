import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { splitImage, createBody } = createRequire(import.meta.url)('./server.js');

test('splitImage separates repo and tag, and defaults to latest', () => {
  assert.deepEqual(splitImage('ghcr.io/raktim94/nodedr-restaurant-pos-backend:1.4.0'), {
    repo: 'ghcr.io/raktim94/nodedr-restaurant-pos-backend',
    tag: '1.4.0',
  });
  assert.deepEqual(splitImage('ghcr.io/raktim94/x'), { repo: 'ghcr.io/raktim94/x', tag: 'latest' });
});

test('splitImage does not mistake a registry port for a tag', () => {
  assert.deepEqual(splitImage('registry.local:5000/team/app'), { repo: 'registry.local:5000/team/app', tag: 'latest' });
  assert.deepEqual(splitImage('registry.local:5000/team/app:2.1.0'), { repo: 'registry.local:5000/team/app', tag: '2.1.0' });
});

const info = (over = {}) => ({
  Id: 'abc123def4567890',
  Config: { Image: 'old:1', Hostname: 'abc123def456', Env: ['APP_VERSION=1.0.0', 'JWT=keep', 'TZ=UTC'], Cmd: ['node', 'x'] },
  HostConfig: { Binds: ['/data:/data'], RestartPolicy: { Name: 'unless-stopped' } },
  NetworkSettings: { Networks: { app_default: { Aliases: ['backend', 'abc123def456'], Links: null } } },
  ...over,
});

test('createBody points at the new image and drops env baked into the old image', () => {
  const b = createBody(info(), 'new:2', ['APP_VERSION=1.0.0', 'TZ=UTC']);
  assert.equal(b.Image, 'new:2');
  assert.deepEqual(b.Env, ['JWT=keep']);
});

test('createBody keeps all env when nothing is baked in', () => {
  assert.deepEqual(createBody(info(), 'new:2').Env, ['APP_VERSION=1.0.0', 'JWT=keep', 'TZ=UTC']);
});

test('createBody drops the auto hostname and the old container id alias, keeps real aliases and host config', () => {
  const b = createBody(info(), 'new:2');
  assert.equal('Hostname' in b, false);
  assert.deepEqual(b.NetworkingConfig.EndpointsConfig.app_default.Aliases, ['backend']);
  assert.deepEqual(b.HostConfig.Binds, ['/data:/data']);
});

test('createBody keeps an explicitly set hostname', () => {
  const b = createBody(info({ Config: { ...info().Config, Hostname: 'kitchen-pc' } }), 'new:2');
  assert.equal(b.Hostname, 'kitchen-pc');
});

test('createBody does not mutate the container it was built from', () => {
  const i = info();
  createBody(i, 'new:2', ['TZ=UTC']);
  assert.equal(i.Config.Image, 'old:1');
  assert.equal(i.Config.Env.length, 3);
});
