/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Regression for audit finding #3 (cross-tenant tableId/customerId/menuItemId):
// an owner of restaurant A must never be able to touch restaurant B's records
// by guessing or leaking an id. Opt-in:
//   TENANT_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand cross-tenant
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.TENANT_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);

run('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ownerA: ReturnType<typeof request.agent>;
  const A = 'demo-branch';
  let restaurantBId: string;
  let tableB: string;
  let customerB: string;
  let itemB: string;
  let itemA: string;
  let tableA: string;

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

    ownerA = request.agent(app.getHttpServer());
    await ownerA
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);

    // Tenant B: a completely separate restaurant with its own records.
    const r = await prisma.restaurant.create({ data: { name: `B ${tag}` } });
    restaurantBId = r.id;
    const b = await prisma.branch.create({
      data: { restaurantId: r.id, name: `B branch ${tag}`, address: 'x' },
    });
    const f = await prisma.floor.create({
      data: { branchId: b.id, name: 'Floor B' },
    });
    const t = await prisma.table.create({
      data: { floorId: f.id, number: `B${tag}` },
    });
    tableB = t.id;
    const c = await prisma.customer.create({
      data: { branchId: b.id, name: 'Victim', phone: `9${tag.length}00000000` },
    });
    customerB = c.id;
    const cat = await prisma.menuCategory.create({
      data: { branchId: b.id, name: 'B cat' },
    });
    const i = await prisma.menuItem.create({
      data: { branchId: b.id, categoryId: cat.id, name: 'B secret', price: 9 },
    });
    itemB = i.id;

    // Tenant A's own records, used for the positive control.
    const ta = await prisma.table.findFirstOrThrow({
      where: { floor: { branchId: A } },
    });
    tableA = ta.id;
    const ia = await prisma.menuItem.findFirstOrThrow({
      where: { branchId: A, isActive: true },
    });
    itemA = ia.id;
  });

  afterAll(async () => {
    await prisma.restaurant.delete({ where: { id: restaurantBId } });
    await app.close();
  });

  const bad = (status: number) => status >= 400 && status < 500;

  it("rejects an order on another restaurant's table and leaves it untouched", async () => {
    const res = await ownerA
      .post(`/api/v1/orders?branchId=${A}`)
      .send({
        type: 'DINE_IN',
        tableId: tableB,
        items: [{ menuItemId: itemA, quantity: 1 }],
      });
    expect(bad(res.status)).toBe(true);
    const t = await prisma.table.findUniqueOrThrow({ where: { id: tableB } });
    expect(t.status).toBe('AVAILABLE');
  });

  it("rejects an order linked to another restaurant's customer", async () => {
    const res = await ownerA
      .post(`/api/v1/orders?branchId=${A}`)
      .send({
        type: 'TAKEAWAY',
        customerId: customerB,
        items: [{ menuItemId: itemA, quantity: 1 }],
      });
    expect(bad(res.status)).toBe(true);
    expect(
      await prisma.order.count({ where: { customerId: customerB } }),
    ).toBe(0);
  });

  it("rejects an order containing another restaurant's menu item", async () => {
    const res = await ownerA
      .post(`/api/v1/orders?branchId=${A}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ menuItemId: itemB, quantity: 1 }],
      });
    expect(bad(res.status)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('B secret');
  });

  it("rejects a reservation on another restaurant's table", async () => {
    const res = await ownerA
      .post(`/api/v1/reservations?branchId=${A}`)
      .send({
        customerName: 'x',
        guestCount: 2,
        reservedAt: new Date(Date.now() + 86_400_000).toISOString(),
        tableId: tableB,
      });
    expect(bad(res.status)).toBe(true);
    const t = await prisma.table.findUniqueOrThrow({ where: { id: tableB } });
    expect(t.status).toBe('AVAILABLE');
  });

  it("rejects seating a waitlist party at another restaurant's table", async () => {
    const w = await ownerA
      .post(`/api/v1/waitlist?branchId=${A}`)
      .send({ customerName: 'w', partySize: 2 });
    expect(w.status).toBeLessThan(300);
    const res = await ownerA
      .post(`/api/v1/waitlist/${w.body.id}/seat?branchId=${A}`)
      .send({ tableId: tableB });
    expect(bad(res.status)).toBe(true);
    const t = await prisma.table.findUniqueOrThrow({ where: { id: tableB } });
    expect(t.status).toBe('AVAILABLE');
  });

  it("rejects a gift card issued to another restaurant's customer", async () => {
    const res = await ownerA
      .post(`/api/v1/gift-cards?branchId=${A}`)
      .send({ initialValue: 100, customerId: customerB });
    expect(bad(res.status)).toBe(true);
  });

  it("cannot update or delete another restaurant's table or customer by id", async () => {
    for (const [method, url] of [
      ['patch', `/api/v1/tables/${tableB}?branchId=${A}`],
      ['delete', `/api/v1/tables/${tableB}?branchId=${A}`],
      ['patch', `/api/v1/customers/${customerB}?branchId=${A}`],
      ['delete', `/api/v1/customers/${customerB}?branchId=${A}`],
    ] as const) {
      const res = await ownerA[method](url).send({ name: 'pwned', number: 'X' });
      expect(bad(res.status)).toBe(true);
    }
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: customerB } }))
        .name,
    ).toBe('Victim');
    expect(await prisma.table.count({ where: { id: tableB } })).toBe(1);
  });

  it("cannot read tenant B's branch data by passing B's branchId", async () => {
    const branchB = (
      await prisma.branch.findFirstOrThrow({
        where: { restaurantId: restaurantBId },
      })
    ).id;
    for (const path of ['tables/floors', 'customers', 'orders', 'menu/items']) {
      const res = await ownerA.get(`/api/v1/${path}?branchId=${branchB}`);
      expect(bad(res.status)).toBe(true);
    }
  });

  it('positive control: the same order on tenant A own table works', async () => {
    const res = await ownerA
      .post(`/api/v1/orders?branchId=${A}`)
      .send({
        type: 'DINE_IN',
        tableId: tableA,
        items: [{ menuItemId: itemA, quantity: 1 }],
      });
    expect(res.status).toBeLessThan(300);
  });

  // The rejections above must come from tenant scoping, not from a malformed
  // request: the identical bodies succeed when the ids belong to tenant A.
  it('positive controls: identical bodies succeed with tenant A ids', async () => {
    const customerA = await prisma.customer.create({
      data: { branchId: A, name: `Own ${tag}`, phone: `8${tag.length}11111111` },
    });
    const gift = await ownerA
      .post(`/api/v1/gift-cards?branchId=${A}`)
      .send({ initialValue: 100, customerId: customerA.id });
    expect(gift.status).toBeLessThan(300);
    const withCustomer = await ownerA
      .post(`/api/v1/orders?branchId=${A}`)
      .send({
        type: 'TAKEAWAY',
        customerId: customerA.id,
        items: [{ menuItemId: itemA, quantity: 1 }],
      });
    expect(withCustomer.status).toBeLessThan(300);
    const resv = await ownerA
      .post(`/api/v1/reservations?branchId=${A}`)
      .send({
        customerName: 'x',
        guestCount: 2,
        reservedAt: new Date(Date.now() + 86_400_000).toISOString(),
        tableId: tableA,
      });
    expect(resv.status).toBeLessThan(300);
  });
});
