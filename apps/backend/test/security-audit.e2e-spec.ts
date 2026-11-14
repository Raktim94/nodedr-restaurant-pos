/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Regressions from the November 2026 security audit (see docs/AUDIT-2026-11.md):
//  - nobody can grant, edit or take over more access than they hold (role/user/2FA/OWNER ceiling)
//  - server-wide operations (backup, update, sync) are not open to every restaurant on a shared server
//  - email login does not let another restaurant's identical email shadow the real account
//  - a refund must be more than zero on every code path
// Opt-in:  SECAUDIT_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand security-audit
import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OrdersService } from './../src/modules/orders/orders.service';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.SECAUDIT_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);
const PW = 'Password123!';

run('Security audit regressions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let ownerId: string;
  let ownerEmail: string;
  const roles: Record<string, string> = {};
  const cleanup: string[] = []; // restaurant ids made here

  const login = async (email: string, password = PW, expected = 201) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/api/v1/auth/login').send({ email, password }).expect(expected);
    return a;
  };
  const mkUser = async (name: string, roleId: string) => {
    const email = `${name}-${tag}@demo.local`;
    const res = await owner.post('/api/v1/users').send({ name, email, password: PW, roleId, branchIds: ['demo-branch'] }).expect(201);
    return { email, id: res.body.id as string };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    owner = await login('owner@demo.local');
    const me = (await owner.get('/api/v1/auth/me').expect(200)).body.user;
    ownerId = me.id;
    ownerEmail = 'owner@demo.local';
    const list = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    for (const r of list) roles[r.name] = r.id;
  });

  afterAll(async () => {
    for (const id of cleanup) await prisma.restaurant.deleteMany({ where: { id } });
    await app.close();
  });

  describe('privilege ceiling', () => {
    let staffAdmin: ReturnType<typeof request.agent>;
    let staffAdminId: string;
    let customRoleId: string;

    beforeAll(async () => {
      // A custom role that may only manage staff and roles: not an owner, not an administrator.
      customRoleId = (
        await owner.post('/api/v1/roles').send({ name: `STAFFMGR_${tag}`, label: 'Staff manager', permissionKeys: ['users.manage', 'roles.manage'] }).expect(201)
      ).body.id;
      const u = await mkUser('staffmgr', customRoleId);
      staffAdminId = u.id;
      staffAdmin = await login(u.email);
    });

    it('cannot promote itself, or create an account, in the OWNER role', async () => {
      expect((await staffAdmin.patch(`/api/v1/users/${staffAdminId}`).send({ roleId: roles.OWNER })).status).toBe(403);
      expect(
        (await staffAdmin.post('/api/v1/users').send({ name: 'x', email: `x-${tag}@demo.local`, password: PW, roleId: roles.OWNER, branchIds: ['demo-branch'] })).status,
      ).toBe(403);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: staffAdminId } })).roleId).toBe(customRoleId);
    });

    it('cannot take over the owner: password, email, 2FA reset, disable and delete are all refused', async () => {
      const before = (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash;
      expect((await staffAdmin.patch(`/api/v1/users/${ownerId}`).send({ password: 'Hijacked123!x' })).status).toBe(403);
      expect((await staffAdmin.patch(`/api/v1/users/${ownerId}`).send({ email: `evil-${tag}@demo.local` })).status).toBe(403);
      expect((await staffAdmin.post(`/api/v1/auth/2fa/reset/${ownerId}`)).status).toBe(403);
      expect((await staffAdmin.patch(`/api/v1/users/${ownerId}`).send({ isActive: false })).status).toBe(403);
      expect((await staffAdmin.delete(`/api/v1/users/${ownerId}`)).status).toBe(403);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
      expect(after.passwordHash).toBe(before);
      expect(after.email).toBe(ownerEmail);
      await login(ownerEmail); // the real owner still signs in
    });

    it('cannot add permissions it lacks to its own role, or edit the OWNER role', async () => {
      const rolePerms = async (id: string) => (await owner.get('/api/v1/roles').expect(200)).body.find((r: { id: string }) => r.id === id);
      expect((await staffAdmin.patch(`/api/v1/roles/${customRoleId}`).send({ permissionKeys: ['users.manage', 'roles.manage', 'backup.manage', 'settings.manage'] })).status).toBe(403);
      expect((await staffAdmin.patch(`/api/v1/roles/${roles.OWNER}`).send({ permissionKeys: ['users.manage'] })).status).toBe(403);
      expect((await staffAdmin.post('/api/v1/roles').send({ name: `GREEDY_${tag}`, label: 'g', permissionKeys: ['backup.manage'] })).status).toBe(403);
      const r = await rolePerms(customRoleId);
      expect(JSON.stringify(r)).not.toContain('backup.manage');
    });

    it('positive control: it can still manage things within its own access', async () => {
      const sub = await staffAdmin.post('/api/v1/roles').send({ name: `SUB_${tag}`, label: 'Sub', permissionKeys: ['users.manage'] });
      expect(sub.status).toBe(201);
      const created = await staffAdmin
        .post('/api/v1/users')
        .send({ name: 'sub', email: `sub-${tag}@demo.local`, password: PW, roleId: sub.body.id, branchIds: ['demo-branch'] });
      expect(created.status).toBe(201);
      expect((await staffAdmin.patch(`/api/v1/users/${created.body.id}`).send({ name: 'sub renamed' })).status).toBe(200);
    });

    it('an ADMINISTRATOR holds every permission but still cannot touch or create an OWNER', async () => {
      const admin = await mkUser('admin1', roles.ADMINISTRATOR);
      const a = await login(admin.email);
      expect((await a.patch(`/api/v1/users/${ownerId}`).send({ password: 'Hijacked123!x' })).status).toBe(403);
      expect((await a.post('/api/v1/users').send({ name: 'x2', email: `x2-${tag}@demo.local`, password: PW, roleId: roles.OWNER, branchIds: ['demo-branch'] })).status).toBe(403);
      expect((await a.patch(`/api/v1/users/${admin.id}`).send({ roleId: roles.OWNER })).status).toBe(403);
      // ...and an owner can do all of it
      await owner.patch(`/api/v1/users/${admin.id}`).send({ name: 'renamed by owner' }).expect(200);
    });
  });

  describe('server-wide operations on a shared server', () => {
    let otherOwner: ReturnType<typeof request.agent>;

    beforeAll(async () => {
      // A second, unrelated restaurant on the same server with its own OWNER holding every permission.
      const r = await prisma.restaurant.create({ data: { name: `Second ${tag}` } });
      cleanup.push(r.id);
      const role = await prisma.role.create({ data: { restaurantId: r.id, name: 'OWNER', label: 'Owner', isSystem: true } });
      const perms = await prisma.permission.findMany({ where: { key: { in: ['backup.manage', 'system.update', 'settings.manage'] } } });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
      await prisma.user.create({ data: { restaurantId: r.id, roleId: role.id, name: 'Other owner', email: `other-${tag}@demo.local`, passwordHash: await bcrypt.hash(PW, 4) } });
      otherOwner = await login(`other-${tag}@demo.local`);
    });

    it("the second restaurant's owner cannot back up, update or re-point sync for the whole server", async () => {
      for (const path of ['/api/v1/backups', '/api/v1/backups/status', '/api/v1/backups/export', '/api/v1/system/update/check', '/api/v1/sync/status']) {
        const res = await otherOwner.get(path);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toMatch(/whole server|every restaurant|Missing permission/);
      }
      expect((await otherOwner.put('/api/v1/sync/settings').send({ serverUrl: 'https://example.com', apiKey: 'x'.repeat(20), mode: 'adopt' })).status).toBe(403);
      expect((await otherOwner.post('/api/v1/backups').send({})).status).toBe(403);
    });

    it('positive control: the restaurant that set the server up still can', async () => {
      expect((await owner.get('/api/v1/backups/status')).status).toBe(200);
      expect((await owner.get('/api/v1/sync/status')).status).toBe(200);
    });
  });

  describe('email login with the same address in two restaurants', () => {
    it('signs in the account whose password matches, whichever restaurant it is in', async () => {
      const r = await prisma.restaurant.create({ data: { name: `Twin ${tag}` } });
      cleanup.push(r.id);
      const role = await prisma.role.create({ data: { restaurantId: r.id, name: 'WAITER', label: 'Waiter', isSystem: false } });
      // Created long before the real owner, so an arbitrary "first match" would pick this one.
      await prisma.user.create({
        data: { restaurantId: r.id, roleId: role.id, name: 'Shadow', email: ownerEmail, passwordHash: await bcrypt.hash('SomethingElse9!', 4), createdAt: new Date('2000-01-01') },
      });
      const a = await login(ownerEmail, PW);
      expect((await a.get('/api/v1/auth/me').expect(200)).body.user.id).toBe(ownerId);
      const shadow = await login(ownerEmail, 'SomethingElse9!');
      expect((await shadow.get('/api/v1/auth/me').expect(200)).body.user.id).not.toBe(ownerId);
      await login(ownerEmail, 'wrong-password', 401);
    });
  });

  describe('refunds', () => {
    it('are refused for zero, negative and non-finite amounts however they are reached', async () => {
      const orders = app.get(OrdersService);
      for (const amount of [-10, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(orders.refund('demo-branch', 'no-such-order', ownerId, { amount, method: 'CASH' } as never)).rejects.toThrow(BadRequestException);
        await expect(orders.refund('demo-branch', 'no-such-order', ownerId, { amount, method: 'CASH' } as never)).rejects.toThrow(/more than zero/);
      }
    });
  });
});
