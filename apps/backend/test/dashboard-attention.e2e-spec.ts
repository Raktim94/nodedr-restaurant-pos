/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Dashboard "needs attention" figures come from the database and are only
// returned to roles allowed to see them.
//   DASHBOARD_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand dashboard-attention
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.DASHBOARD_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
// These suites create a second restaurant, which needs sign-up opened (it is closed by default).
process.env.ALLOW_PUBLIC_SIGNUP = 'true';
const tag = randomUUID().slice(0, 6);

run('Dashboard attention figures (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let menuItemId: string;

  const summary = async (a: ReturnType<typeof request.agent>) =>
    (await a.get(`/api/v1/dashboard/summary${q}`).expect(200)).body;

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
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `dash-cashier-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: `Cashier ${tag}`,
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    const cats = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body;
    menuItemId = (
      await owner
        .post(`/api/v1/menu/items${q}`)
        .send({
          categoryId: cats[0].id,
          name: `DashItem-${tag}`,
          price: 350,
          taxRatePercent: 0,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts a part-paid bill and the balance still owed, then drops it when settled', async () => {
    const before = await summary(owner);
    const order = (
      await owner
        .post(`/api/v1/orders${q}`)
        .send({
          type: 'TAKEAWAY',
          guestName: 'Pay later',
          items: [{ menuItemId, quantity: 1, modifierIds: [] }],
        })
        .expect(201)
    ).body;
    // An unpaid bill is not "pending payment" until money has been taken.
    expect((await summary(owner)).pendingPayments.count).toBe(
      before.pendingPayments.count,
    );

    await owner
      .post(`/api/v1/orders/${order.id}/checkout${q}`)
      .send({ allowPartial: true, payments: [{ method: 'CASH', amount: 300 }] })
      .expect(201);
    const mid = await summary(owner);
    expect(mid.pendingPayments.count).toBe(before.pendingPayments.count + 1);
    expect(mid.pendingPayments.balance).toBeCloseTo(
      before.pendingPayments.balance + 50,
      2,
    );

    await owner
      .post(`/api/v1/orders/${order.id}/checkout${q}`)
      .send({ payments: [{ method: 'CASH', amount: 50 }] })
      .expect(201);
    const after = await summary(owner);
    expect(after.pendingPayments.count).toBe(before.pendingPayments.count);
    expect(after.pendingPayments.balance).toBeCloseTo(
      before.pendingPayments.balance,
      2,
    );
  });

  it('matches the database for customers, employees and low stock', async () => {
    const s = await summary(owner);
    expect(s.customers).toBe(
      await prisma.customer.count({ where: { branchId: BRANCH } }),
    );
    expect(s.employees).toBe(
      await prisma.user.count({
        where: { isActive: true, branches: { some: { branchId: BRANCH } } },
      }),
    );
    const ing = await prisma.ingredient.findMany({
      where: { branchId: BRANCH },
    });
    expect(s.lowStock).toBe(
      ing.filter((i) => Number(i.currentStock) <= Number(i.reorderLevel))
        .length,
    );
    expect(s.unpaidPayrollRuns).toBe(
      await prisma.payrollRun.count({
        where: { branchId: BRANCH, status: { in: ['DRAFT', 'FINALIZED'] } },
      }),
    );
  });

  it('never returns restricted figures to a role without the permission', async () => {
    const s = await summary(cashier);
    expect(typeof s.customers).toBe('number'); // customers.manage
    expect(s.employees).toBeNull(); // staff.manage
    expect(s.unpaidPayrollRuns).toBeNull();
    expect(s.lowStock).toBeNull(); // inventory.manage
  });
});

run('Display settings for every role (e2e)', () => {
  // Shares the app wiring style of the suite above, in its own module.
  let app: INestApplication<App>;
  let cashier: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  const t = randomUUID().slice(0, 6);

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
    const owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `disp-cashier-${t}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: 'Disp Cashier',
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    const otherEmail = `disp-other-${t}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ownerName: 'Other',
        email: otherEmail,
        password: 'Password123!',
        restaurantName: `Other ${t}`,
        branchName: 'Main',
      })
      .expect(201);
    other = request.agent(app.getHttpServer());
    await other
      .post('/api/v1/auth/login')
      .send({ email: otherEmail, password: 'Password123!' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a cashier can read the display slice but not the full settings', async () => {
    const res = await cashier.get(`/api/v1/settings/display${q}`).expect(200);
    expect(res.body.restaurant.currency).toBeDefined();
    expect(res.body.restaurant.maxManualDiscountPercent).toBeDefined();
    expect(res.body.branch.taxMode).toBeDefined();
    // Nothing sensitive leaks through the allow-list.
    expect(res.body.branch).not.toHaveProperty('kioskToken');
    expect(res.body.branch).not.toHaveProperty('printerHost');
    expect(res.body.restaurant).not.toHaveProperty('integrationApiKeys');
    await cashier.get(`/api/v1/settings${q}`).expect(403);
  });

  it("refuses another restaurant's branch and anonymous callers", async () => {
    await other.get(`/api/v1/settings/display${q}`).expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/settings/display${q}`)
      .expect(401);
  });
});

run('Dashboard layout preferences (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  const t = randomUUID().slice(0, 6);
  const P = '/api/v1/dashboard/preferences';

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
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `pref-cashier-${t}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: 'Pref Cashier',
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    // Start from a known layout: the demo owner is shared with other suites
    // and with anyone who has been clicking around the running app.
    await owner.put(P).send({}).expect(200);
  });

  afterAll(async () => {
    // Leave the shared demo owner's layout as we found it.
    await owner.put(P).send({}).expect(200);
    await app.close();
  });

  it('starts at the default layout', async () => {
    const res = await cashier.get(P).expect(200);
    expect(res.body).toEqual({
      topOrder: ['kpis', 'attention', 'charts'],
      cardOrder: ['tables', 'kitchen', 'recent', 'channels'],
      hidden: [],
      trendDays: 14,
    });
  });

  it('saves, returns and keeps a custom layout', async () => {
    const saved = await cashier
      .put(P)
      .send({
        topOrder: ['charts', 'kpis', 'attention'],
        cardOrder: ['recent', 'tables'],
        hidden: ['channels'],
        trendDays: 30,
      })
      .expect(200);
    expect(saved.body.topOrder).toEqual(['charts', 'kpis', 'attention']);
    expect(saved.body.cardOrder).toEqual([
      'recent',
      'tables',
      'kitchen',
      'channels',
    ]);
    expect(saved.body.hidden).toEqual(['channels']);
    const again = (await cashier.get(P).expect(200)).body;
    expect(again).toEqual(saved.body);
  });

  it("one person's layout never changes another's", async () => {
    const mine = (await owner.get(P).expect(200)).body;
    expect(mine.hidden).toEqual([]);
    expect(mine.trendDays).toBe(14);
  });

  it('cleans up garbage instead of storing it', async () => {
    const res = await cashier
      .put(P)
      .send({
        topOrder: ['kpis', '<script>', { a: 1 }, 'kpis'],
        hidden: ['tables', 'nope'],
        trendDays: 9999,
        extra: 'ignored',
      })
      .expect(200);
    expect(res.body.topOrder).toEqual(['kpis', 'attention', 'charts']);
    expect(res.body.hidden).toEqual(['tables']);
    expect(res.body.trendDays).toBe(14);
    expect(res.body).not.toHaveProperty('extra');
  });

  it('needs a signed-in user', async () => {
    await request(app.getHttpServer()).get(P).expect(401);
    await request(app.getHttpServer()).put(P).send({}).expect(401);
  });

  it('chart windows: only the supported ones, and the data matches', async () => {
    const ok = await owner
      .get(`/api/v1/dashboard/trends${q}&days=30`)
      .expect(200);
    expect(ok.body.revenue).toHaveLength(30);
    const def = await owner.get(`/api/v1/dashboard/trends${q}`).expect(200);
    expect(def.body.revenue).toHaveLength(14);
    await owner.get(`/api/v1/dashboard/trends${q}&days=1000`).expect(400);
    await owner.get(`/api/v1/dashboard/trends${q}&days=abc`).expect(400);
  });
});
