// Per-user permission overrides + departments + invoice-text parsing, end to
// end against a real migrated + seeded Postgres.
//   OVERRIDES_E2E=1 DATABASE_URL=... JWT_SECRET=x npm run test:e2e -- permission-overrides
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.OVERRIDES_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);

run('Permission overrides & departments (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let waiter: ReturnType<typeof request.agent>;
  let waiterId = '';
  let ownerId = '';
  const login = async (email: string, password: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/api/v1/auth/login').send({ email, password }).expect(201);
    return a;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();

    owner = await login('owner@demo.local', 'Password123!');
    const me = await owner.get('/api/v1/auth/me').expect(200);
    ownerId = (me.body as { user: { id: string } }).user.id;
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const created = await owner
      .post('/api/v1/users')
      .send({
        name: `Waiter ${tag}`,
        email: `w-${tag}@demo.local`,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'WAITER')!.id,
        branchIds: ['demo-branch'],
      })
      .expect(201);
    waiterId = (created.body as { id: string }).id;
    waiter = await login(`w-${tag}@demo.local`, 'Password123!');
  });

  afterAll(async () => {
    await owner.delete(`/api/v1/users/${waiterId}`);
    await app.close();
  });

  const put = (id: string, overrides: unknown[]) =>
    owner.put(`/api/v1/users/${id}/permission-overrides`).send({ overrides });

  it('a waiter cannot read reports until granted, and loses it when revoked', async () => {
    await waiter.get('/api/v1/users').expect(403);
    await put(waiterId, [
      { permissionKey: 'users.manage', effect: 'GRANT' },
    ]).expect(200);
    await waiter.get('/api/v1/users').expect(200); // live: no re-login needed
    await put(waiterId, []).expect(200);
    await waiter.get('/api/v1/users').expect(403);
  });

  it('DENY removes a permission the role has', async () => {
    await waiter
      .get('/api/v1/auth/me')
      .expect(200)
      .then((r) => {
        expect(
          (r.body as { user: { permissions: string[] } }).user.permissions,
        ).toContain('orders.create');
      });
    await put(waiterId, [
      { permissionKey: 'orders.create', effect: 'DENY' },
    ]).expect(200);
    const r = await waiter.get('/api/v1/auth/me').expect(200);
    expect(
      (r.body as { user: { permissions: string[] } }).user.permissions,
    ).not.toContain('orders.create');
    await put(waiterId, []).expect(200);
  });

  it('expired overrides are ignored (expiry set in the past is rejected at write time)', async () => {
    await put(waiterId, [
      {
        permissionKey: 'users.manage',
        effect: 'GRANT',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ]).expect(400);
  });

  it('rejects self-edit, owner target, unknown keys, duplicates', async () => {
    await put(ownerId, []).expect(400);
    await put(waiterId, [
      { permissionKey: 'nope.nope', effect: 'DENY' },
    ]).expect(400);
    await put(waiterId, [
      { permissionKey: 'bills.print', effect: 'DENY' },
      { permissionKey: 'bills.print', effect: 'GRANT' },
    ]).expect(400);
  });

  it('cannot escalate: a granted manager cannot hand out permissions they lack', async () => {
    await put(waiterId, [
      { permissionKey: 'users.manage', effect: 'GRANT' },
      { permissionKey: 'roles.manage', effect: 'GRANT' },
    ]).expect(200);
    // waiter now manages users+roles but does NOT hold e.g. backup.manage.
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const other = await owner
      .post('/api/v1/users')
      .send({
        name: `Other ${tag}`,
        email: `o-${tag}@demo.local`,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'WAITER')!.id,
        branchIds: ['demo-branch'],
      })
      .expect(201);
    const otherId = (other.body as { id: string }).id;
    await waiter
      .put(`/api/v1/users/${otherId}/permission-overrides`)
      .send({
        overrides: [{ permissionKey: 'backup.manage', effect: 'GRANT' }],
      })
      .expect(400);
    await put(waiterId, []).expect(200);
    await owner.delete(`/api/v1/users/${otherId}`).expect(200);
  });

  it('departments: CRUD, assignment, duplicate name, cross-tenant id rejected', async () => {
    const d = await owner
      .post('/api/v1/users/departments')
      .send({ name: `Kitchen ${tag}` })
      .expect(201);
    const id = (d.body as { id: string }).id;
    await owner
      .post('/api/v1/users/departments')
      .send({ name: `Kitchen ${tag}` })
      .expect(409);
    await owner
      .patch(`/api/v1/users/${waiterId}`)
      .send({ departmentId: id })
      .expect(200);
    await owner
      .patch(`/api/v1/users/${waiterId}`)
      .send({ departmentId: 'not-a-dept' })
      .expect(400);
    const list = await owner.get('/api/v1/users/departments').expect(200);
    expect(
      (list.body as { id: string; _count: { users: number } }[]).find(
        (x) => x.id === id,
      )?._count.users,
    ).toBe(1);
    await owner.delete(`/api/v1/users/departments/${id}`).expect(200);
    const users = (await owner.get('/api/v1/users').expect(200)).body as {
      id: string;
      departmentId: string | null;
    }[];
    expect(users.find((u) => u.id === waiterId)?.departmentId).toBeNull();
  });

  it('parse-text needs inventory.manage and returns structured fields', async () => {
    const text =
      'Acme Foods\nInvoice No: A-77\nDate: 03/11/2026\nTotal: Rs. 1,500.00';
    const url =
      '/api/v1/inventory/supplier-invoices/parse-text?branchId=demo-branch';
    await waiter.post(url).send({ text }).expect(403);
    const r = await owner.post(url).send({ text }).expect(201);
    expect(r.body).toMatchObject({
      invoiceNumber: 'A-77',
      invoiceDate: '2026-11-03',
      totalAmount: 1500,
    });
    await owner.post(url).send({ text: '' }).expect(400);
    await owner
      .post(url)
      .send({ text: 'x'.repeat(20_001) })
      .expect(400);
  });
});
