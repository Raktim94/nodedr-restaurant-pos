/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Discount cap, mandatory reason and part/over payment recorded through the
// real HTTP API and database. Opt-in:
//   DISCOUNT_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand discount-guard
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.DISCOUNT_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Discount guardrails and payment recording (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let menuItemId: string;
  let restaurantId: string;

  const newOrder = async (price?: number) => {
    const res = await owner
      .post(`/api/v1/orders${q}`)
      .send({
        type: 'TAKEAWAY',
        guestName: 'Walk-in',
        items: [{ menuItemId, quantity: 1, modifierIds: [] }],
      })
      .expect(201);
    void price;
    return res.body as { id: string };
  };
  const checkout = (
    a: ReturnType<typeof request.agent>,
    id: string,
    body: object,
  ) => a.post(`/api/v1/orders/${id}/checkout${q}`).send(body);
  const setPolicy = (max: number, requireReason: boolean) =>
    owner
      .patch('/api/v1/settings/restaurant')
      .send({
        maxManualDiscountPercent: max,
        requireDiscountReason: requireReason,
      })
      .expect(200);

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
    restaurantId = (
      await prisma.branch.findUniqueOrThrow({ where: { id: BRANCH } })
    ).restaurantId;

    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `cashier-${tag}@demo.local`;
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
          name: `Thali-${tag}`,
          price: 350,
          taxRatePercent: 0,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { maxManualDiscountPercent: 100, requireDiscountReason: false },
    });
    await app.close();
  });

  it('defaults to no cap and no mandatory reason', async () => {
    await setPolicy(100, false);
    const o = await newOrder();
    const res = await checkout(cashier, o.id, {
      discountPercent: 50,
      payments: [{ method: 'CASH', amount: 175 }],
    });
    expect(res.status).toBe(201);
    expect(Number(res.body.totalAmount)).toBe(175);
  });

  it('refuses a cashier discount above the cap, allows it for the owner', async () => {
    await setPolicy(10, false);
    const o = await newOrder();
    const blocked = await checkout(cashier, o.id, {
      discountPercent: 20,
      payments: [{ method: 'CASH', amount: 280 }],
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/above 10%/);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status,
    ).toBe('OPEN');

    const ok = await checkout(owner, o.id, {
      discountPercent: 20,
      discountReason: 'Owner comp',
      payments: [{ method: 'CASH', amount: 280 }],
    });
    expect(ok.status).toBe(201);
  });

  it('measures a flat discount against the cap too', async () => {
    await setPolicy(10, false);
    const o = await newOrder();
    const res = await checkout(cashier, o.id, {
      discountFlat: 100, // 28.6% of 350
      payments: [{ method: 'CASH', amount: 250 }],
    });
    expect(res.status).toBe(400);
  });

  it('requires and stores a reason when configured', async () => {
    await setPolicy(100, true);
    const o = await newOrder();
    const missing = await checkout(cashier, o.id, {
      discountPercent: 10,
      payments: [{ method: 'CASH', amount: 315 }],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/reason/i);

    const ok = await checkout(cashier, o.id, {
      discountPercent: 10,
      discountReason: 'Regular guest',
      payments: [{ method: 'CASH', amount: 315 }],
    });
    expect(ok.status).toBe(201);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: o.id },
    });
    expect(stored.discountReason).toBe('Regular guest');
    expect(Number(stored.discountAmount)).toBe(35);
  });

  it('does not demand a reason when there is no discount', async () => {
    await setPolicy(100, true);
    const o = await newOrder();
    const res = await checkout(cashier, o.id, {
      payments: [{ method: 'CASH', amount: 350 }],
    });
    expect(res.status).toBe(201);
  });

  it('records 300 on a 350 bill as partial, never as paid', async () => {
    await setPolicy(100, false);
    const o = await newOrder();
    const res = await checkout(cashier, o.id, {
      allowPartial: true,
      payments: [{ method: 'CASH', amount: 300 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.settlement).toMatchObject({
      amountDue: 350,
      amountPaid: 300,
      balanceDue: 50,
      fullyPaid: false,
    });
    const rows = await prisma.payment.findMany({ where: { orderId: o.id } });
    expect(rows.map((p) => Number(p.amount))).toEqual([300]);

    const rest = await checkout(cashier, o.id, {
      payments: [{ method: 'UPI', amount: 50 }],
    });
    expect(rest.status).toBe(201);
    expect(rest.body.status).toBe('PAID');
  });

  it('stores 350 applied, 400 tendered and 50 change for excess cash', async () => {
    const o = await newOrder();
    const res = await checkout(cashier, o.id, {
      payments: [{ method: 'CASH', amount: 350, tendered: 400 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.settlement).toMatchObject({
      balanceDue: 0,
      changeDue: 50,
      fullyPaid: true,
    });
    const [p] = await prisma.payment.findMany({ where: { orderId: o.id } });
    expect([
      Number(p.amount),
      Number(p.tendered),
      Number(p.changeGiven),
    ]).toEqual([350, 400, 50]);
  });
});
