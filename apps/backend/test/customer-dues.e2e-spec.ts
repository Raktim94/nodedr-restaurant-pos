/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies are untyped by design */
//   DUES_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand customer-dues
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.DUES_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Customer credit, part payments and dues (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let menuItemId: string;
  let anna: string;
  let ben: string;

  const newOrder = async () =>
    (
      await owner
        .post(`/api/v1/orders${q}`)
        .send({
          type: 'TAKEAWAY',
          guestName: 'Walk-in',
          items: [{ menuItemId, quantity: 1, modifierIds: [] }],
        })
        .expect(201)
    ).body as { id: string; orderNumber: string };
  const pay = (id: string, body: object) =>
    owner.post(`/api/v1/orders/${id}/checkout${q}`).send(body);
  const dues = async (extra = '') =>
    (await owner.get(`/api/v1/orders/dues${q}${extra}`).expect(200)).body as {
      rows: {
        orderId: string;
        status: string;
        total: number;
        paid: number;
        balance: number;
        customer: { id: string; phone: string | null };
        payments: { amount: number }[];
      }[];
      totalOutstanding: number;
      customers: { customerId: string; owed: number; bills: number }[];
    };
  const mine = (d: Awaited<ReturnType<typeof dues>>, id: string) =>
    d.rows.find((r) => r.orderId === id);

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
    const cats = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body;
    menuItemId = (
      await owner
        .post(`/api/v1/menu/items${q}`)
        .send({
          categoryId: cats[0].id,
          name: `Feast-${tag}`,
          price: 1200,
          taxRatePercent: 0,
        })
        .expect(201)
    ).body.id;
    const mk = async (name: string, phone: string) =>
      (
        await owner
          .post(`/api/v1/customers${q}`)
          .send({ name: `${name} ${tag}`, phone })
          .expect(201)
      ).body.id as string;
    anna = await mk('Anna', '+91 98765 43210');
    ben = await mk('Ben', '');
  });
  afterAll(async () => {
    await app.close();
  });

  it('a 1200 bill with 500 paid shows 700 owed against the named customer', async () => {
    const o = await newOrder();
    const res = await pay(o.id, {
      customerId: anna,
      allowPartial: true,
      requestId: `r1-${tag}`,
      payments: [{ method: 'UPI', amount: 500 }],
    }).expect(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.settlement).toMatchObject({
      amountPaid: 500,
      balanceDue: 700,
      fullyPaid: false,
    });
    const d = await dues();
    expect(mine(d, o.id)).toMatchObject({
      status: 'PARTIAL',
      total: 1200,
      paid: 500,
      balance: 700,
    });
    expect(mine(d, o.id)?.customer.id).toBe(anna);
    expect(mine(d, o.id)?.payments.map((p) => p.amount)).toEqual([500]);
    expect(d.customers.find((c) => c.customerId === anna)?.owed).toBe(700);
  });

  it('a retried submission with the same request id records the payment once', async () => {
    const o = await newOrder();
    const body = {
      customerId: anna,
      allowPartial: true,
      requestId: `retry-${tag}`,
      payments: [{ method: 'CASH', amount: 200 }],
    };
    await pay(o.id, body).expect(201);
    await pay(o.id, body).expect(201); // a double tap / dropped connection
    const rows = await prisma.payment.findMany({ where: { orderId: o.id } });
    expect(rows.map((p) => Number(p.amount))).toEqual([200]);
    expect(mine(await dues(), o.id)?.balance).toBe(1000);
  });

  it('an unpaid bill left with a customer is listed as UNPAID with the full balance', async () => {
    const o = await newOrder();
    // an order is linked to a customer at checkout; an unpaid bill left on the account is linked directly
    await prisma.order.update({
      where: { id: o.id },
      data: { customerId: ben },
    });
    const d = await dues('&status=UNPAID');
    expect(mine(d, o.id)).toMatchObject({
      status: 'UNPAID',
      paid: 0,
      balance: 1200,
    });
    expect(d.rows.every((r) => r.status === 'UNPAID')).toBe(true);
  });

  it('filters by status and customer', async () => {
    const partial = await dues('&status=PARTIAL');
    expect(partial.rows.every((r) => r.status === 'PARTIAL')).toBe(true);
    const onlyBen = await dues(`&customerId=${ben}`);
    expect(onlyBen.rows.length).toBeGreaterThan(0);
    expect(onlyBen.rows.every((r) => r.customer.id === ben)).toBe(true);
    const future = await dues('&from=2099-01-01');
    expect(future.rows).toHaveLength(0);
    await owner.get(`/api/v1/orders/dues${q}&status=BOGUS`).expect(400);
    await owner.get(`/api/v1/orders/dues${q}&from=not-a-date`).expect(400);
  });

  it('a later payment settles the bill, rejects overpayment, and the balance disappears from dues', async () => {
    const o = await newOrder();
    await pay(o.id, {
      customerId: anna,
      allowPartial: true,
      payments: [{ method: 'CASH', amount: 500 }],
    }).expect(201);
    const before = await dues();
    expect(mine(before, o.id)?.balance).toBe(700);

    // paying more than is owed is refused and records nothing
    const over = await pay(o.id, {
      payments: [{ method: 'UPI', amount: 900 }],
    });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/exceed the amount due/);
    const rows = await prisma.payment.findMany({ where: { orderId: o.id } });
    expect(rows.map((p) => Number(p.amount))).toEqual([500]);

    const after = await pay(o.id, {
      payments: [{ method: 'UPI', amount: 700 }],
    }).expect(201);
    expect(after.body.status).toBe('PAID');
    const d = await dues();
    expect(mine(d, o.id)).toBeUndefined();
    const paid = await dues('&status=PAID');
    expect(mine(paid, o.id)).toMatchObject({ status: 'PAID', balance: 0 });
    expect(mine(paid, o.id)?.payments.length).toBeGreaterThanOrEqual(2);
  });

  it('is protected: no session, no dues', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/orders/dues${q}`)
      .expect(401);
  });
});
