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

  it('a phone has its own session: removing the phone ends it even without the device header, and it cannot sign in again', async () => {
    const email = `cashier-${tag}@demo.local`;
    // role was changed by the last test in an earlier run order; use the owner session to make a fresh cashier
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const em = `phone-user-${tag}@demo.local`;
    await owner.post('/api/v1/users').send({ name: `Phone ${tag}`, email: em, password: 'Password123!', roleId: roles.find((r) => r.name === 'CASHIER')!.id, branchIds: [BRANCH] }).expect(201);
    const did = `phone-${randomUUID()}`;
    const mine = request.agent(app.getHttpServer());
    await mine.post('/api/v1/auth/login').send({ email: em, password: 'Password123!', deviceId: did }).expect(201);
    await mine.post('/api/v1/pos-devices/heartbeat').send({ deviceId: did, name: 'Bar phone' }).expect(201);
    expect((await mine.get(`/api/v1/menu/items${q}`)).status).toBe(200);
    const row = ((await owner.get('/api/v1/pos-devices').expect(200)).body as { id: string; deviceId: string }[]).find((d) => d.deviceId === did)!;
    await owner.post(`/api/v1/pos-devices/${row.id}/revoke`).expect(201);
    const after = await mine.get(`/api/v1/menu/items${q}`); // no X-Device-Id header at all
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('DEVICE_REVOKED');
    const again = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: em, password: 'Password123!', deviceId: did });
    expect(again.status).toBe(403);
    // the same person on the web (no device id) is not affected
    const web = request.agent(app.getHttpServer());
    await web.post('/api/v1/auth/login').send({ email: em, password: 'Password123!' }).expect(201);
    expect((await web.get(`/api/v1/menu/items${q}`)).status).toBe(200);
    void email;
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

run('Offline attendance events (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let me: ReturnType<typeof request.agent>;
  const t2 = randomUUID().slice(0, 6);
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

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
    const em = `clock-${t2}@demo.local`;
    await owner.post('/api/v1/users').send({ name: `Clock ${t2}`, email: em, password: 'Password123!', roleId: roles.find((r) => r.name === 'WAITER')!.id, branchIds: [BRANCH] }).expect(201);
    me = request.agent(app.getHttpServer());
    await me.post('/api/v1/auth/login').send({ email: em, password: 'Password123!' }).expect(201);
  });
  afterAll(async () => app.close());

  it('records a shift that happened offline with its real times, once, however often it is resent', async () => {
    const kIn = `in-${randomUUID()}`;
    const kOut = `out-${randomUUID()}`;
    const a = await me.post('/api/v1/attendance/events').send({ type: 'IN', at: ago(9), branchId: BRANCH, idempotencyKey: kIn }).expect(201);
    const a2 = await me.post('/api/v1/attendance/events').send({ type: 'IN', at: ago(9), branchId: BRANCH, idempotencyKey: kIn }).expect(201);
    expect(a2.body.id).toBe(a.body.id);
    const b = await me.post('/api/v1/attendance/events').send({ type: 'OUT', at: ago(1), branchId: BRANCH, idempotencyKey: kOut, breakMinutes: 30 }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(Math.abs(new Date(b.body.clockOutAt).getTime() - new Date(b.body.clockInAt).getTime() - 8 * 3_600_000)).toBeLessThan(2000);
    const b2 = await me.post('/api/v1/attendance/events').send({ type: 'OUT', at: ago(1), branchId: BRANCH, idempotencyKey: kOut, breakMinutes: 30 }).expect(201);
    expect(b2.body.id).toBe(a.body.id);
  });

  it('refuses clashes with the reason: future time, overlap, nothing to clock out of', async () => {
    const k = () => `k-${randomUUID()}`;
    expect((await me.post('/api/v1/attendance/events').send({ type: 'IN', at: new Date(Date.now() + 3_600_000).toISOString(), branchId: BRANCH, idempotencyKey: k() })).status).toBe(400);
    const overlap = await me.post('/api/v1/attendance/events').send({ type: 'IN', at: ago(5), branchId: BRANCH, idempotencyKey: k() });
    expect(overlap.status).toBe(409); // inside the shift recorded above
    const nothing = await me.post('/api/v1/attendance/events').send({ type: 'OUT', at: ago(0.5), branchId: BRANCH, idempotencyKey: k() });
    expect(nothing.status).toBe(409);
    expect((await me.post('/api/v1/attendance/events').send({ type: 'IN', at: ago(24 * 30), branchId: BRANCH, idempotencyKey: k() })).status).toBe(400);
  });
});
