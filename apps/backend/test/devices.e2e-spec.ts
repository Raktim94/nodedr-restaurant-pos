/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
//   DEVICES_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand devices
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.DEVICES_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Enrolled phones (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  const deviceId = `phone-${randomUUID()}`;
  let id: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const email = `cashier-${tag}@demo.local`;
    await owner.post('/api/v1/users').send({ name: `Cashier ${tag}`, email, password: 'Password123!', roleId: roles.find((r) => r.name === 'CASHIER')!.id, branchIds: [BRANCH] }).expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier.post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(201);
  });
  afterAll(async () => app.close());

  it('a phone enrols itself and reports its queue; owners see it, cashiers cannot', async () => {
    await cashier.post('/api/v1/pos-devices/heartbeat').set('X-Device-Id', deviceId).send({ deviceId, name: 'Counter phone', platform: 'ANDROID', appVersion: '1.27.0', pending: 3, failed: 1, synced: true }).expect(201);
    const list = (await owner.get('/api/v1/pos-devices').expect(200)).body as { id: string; deviceId: string; pendingCount: number; failedCount: number; lastSyncAt: string | null; revokedAt: string | null }[];
    const mine = list.find((d) => d.deviceId === deviceId)!;
    id = mine.id;
    expect(mine.pendingCount).toBe(3);
    expect(mine.failedCount).toBe(1);
    expect(mine.lastSyncAt).not.toBeNull();
    expect((await cashier.get('/api/v1/pos-devices')).status).toBe(403);
    expect((await cashier.post(`/api/v1/pos-devices/${id}/revoke`)).status).toBe(403);
  });

  it('revoking switches that phone off at once, but not the same user on another device or the web', async () => {
    await owner.post(`/api/v1/pos-devices/${id}/revoke`).expect(201);
    const blocked = await cashier.get(`/api/v1/menu/items${q}`).set('X-Device-Id', deviceId);
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('DEVICE_REVOKED');
    expect((await cashier.post('/api/v1/pos-devices/heartbeat').set('X-Device-Id', deviceId).send({ deviceId, name: 'x' })).status).toBe(401);
    expect((await cashier.get(`/api/v1/menu/items${q}`).set('X-Device-Id', `other-${randomUUID()}`)).status).toBe(200);
    expect((await cashier.get(`/api/v1/menu/items${q}`)).status).toBe(200);
  });

  it('a restored phone works again', async () => {
    await owner.post(`/api/v1/pos-devices/${id}/restore`).expect(201);
    expect((await cashier.get(`/api/v1/menu/items${q}`).set('X-Device-Id', deviceId)).status).toBe(200);
  });

  it('role changes take effect on the next request', async () => {
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const users = (await owner.get('/api/v1/users').expect(200)).body as { id: string; email: string }[];
    const u = users.find((x) => x.email === `cashier-${tag}@demo.local`)!;
    expect((await cashier.get(`/api/v1/menu/items${q}`)).status).toBe(200);
    await owner.patch(`/api/v1/users/${u.id}`).send({ roleId: roles.find((r) => r.name === 'DELIVERY_STAFF')!.id }).expect(200);
    expect((await cashier.get(`/api/v1/menu/items${q}`)).status).toBe(403); // delivery staff cannot read the menu
  });
});
