/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Standalone mode: the phone's snapshot and sales taken offline coming back.
//   STANDALONE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand standalone
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.STANDALONE_E2E ? describe : describe.skip;
const tag = String(Date.now()).slice(-8);

run('Standalone mode (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let branchId: string;
  let itemId: string;
  const http = () => request(app.getHttpServer());
  const saleBase = (n: number) => ({
    id: `offline-${tag}-${n}`,
    localNumber: `OFF-${n}`,
    soldAt: new Date(Date.now() - 3_600_000).toISOString(),
    type: 'TAKEAWAY',
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const me = (await owner.get('/api/v1/auth/me').expect(200)).body.user;
    // A plain dish (no required options, not a combo) on any branch of this restaurant.
    const dish = await prisma.menuItem.findFirstOrThrow({
      where: {
        isActive: true,
        isCombo: false,
        price: { gt: 0 },
        branch: { restaurantId: me.restaurantId },
        modifierGroups: { none: {} },
      },
    });
    branchId = dish.branchId;
    itemId = dish.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('the snapshot carries the menu, tables and what the receipt needs', async () => {
    const s = (await owner.get(`/api/v1/mobile/standalone/snapshot?branchId=${branchId}`).expect(200)).body;
    expect(s.branch.id).toBe(branchId);
    expect(s.items.length).toBeGreaterThan(0);
    expect(s.items[0]).toEqual(expect.objectContaining({ id: expect.any(String), price: expect.any(Number), taxRate: expect.any(Number) }));
    expect(s.categories.length).toBeGreaterThan(0);
    expect(s.restaurant.currency).toBeTruthy();
    expect(Array.isArray(s.floors)).toBe(true);
  });

  it('is closed to someone who is not signed in', async () => {
    await http().get(`/api/v1/mobile/standalone/snapshot?branchId=${branchId}`).expect(401);
    await http().post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`).send({ sales: [] }).expect(401);
  });

  it('records an offline sale at the price the customer paid, once', async () => {
    const sale = {
      ...saleBase(1),
      items: [{ menuItemId: itemId, quantity: 2, unitPrice: 77 }],
      payments: [{ method: 'CASH', amount: 154, tendered: 200 }],
    };
    const first = (await owner.post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`).send({ deviceName: 'Test phone', sales: [sale] }).expect(201)).body;
    expect(first.results[0].status).toBe('created');

    const order = await prisma.order.findFirstOrThrow({
      where: { branchId, clientRequestId: sale.id },
      include: { items: true, payments: true, kots: true },
    });
    expect(order.status).toBe('PAID');
    expect(Number(order.totalAmount)).toBe(154);
    expect(Number(order.items[0].unitPriceSnapshot)).toBe(77);
    expect(order.payments).toHaveLength(1);
    expect(Number(order.payments[0].changeGiven)).toBe(46);
    expect(order.kots).toHaveLength(0); // never reaches the kitchen
    expect(order.notes).toContain('OFF-1');
    expect(order.createdAt.getTime()).toBeLessThan(Date.now() - 3_000_000);

    // The same sale sent again (a dropped reply) is not recorded twice.
    const again = (await owner.post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`).send({ sales: [sale] }).expect(201)).body;
    expect(again.results[0]).toEqual(expect.objectContaining({ status: 'duplicate', orderId: order.id }));
    expect(await prisma.order.count({ where: { branchId, clientRequestId: sale.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('applies a discount and a UPI payment', async () => {
    const sale = {
      ...saleBase(2),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: 100 }],
      discountPercent: 10,
      payments: [{ method: 'UPI', amount: 90, reference: 'UPI123' }],
    };
    const r = (await owner.post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`).send({ sales: [sale] }).expect(201)).body;
    expect(r.results[0].status).toBe('created');
    const order = await prisma.order.findFirstOrThrow({ where: { branchId, clientRequestId: sale.id } });
    expect(order.status).toBe('PAID');
    expect(Number(order.discountAmount)).toBe(10);
    expect(Number(order.totalAmount)).toBe(90);
  });

  it('refuses a sale whose payment does not cover it and leaves nothing open', async () => {
    const sale = {
      ...saleBase(3),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: 100 }],
      payments: [{ method: 'CASH', amount: 40 }],
    };
    const r = (await owner.post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`).send({ sales: [sale] }).expect(201)).body;
    expect(r.results[0].status).toBe('refused');
    const order = await prisma.order.findFirstOrThrow({ where: { branchId, clientRequestId: sale.id } });
    expect(order.status).toBe('CANCELLED');
  });

  it('refuses a dish that is not on this branch menu, without stopping the others', async () => {
    const good = { ...saleBase(4), items: [{ menuItemId: itemId, quantity: 1, unitPrice: 50 }], payments: [{ method: 'CASH', amount: 50 }] };
    const bad = { ...saleBase(5), items: [{ menuItemId: 'not-a-real-dish', quantity: 1, unitPrice: 50 }], payments: [{ method: 'CASH', amount: 50 }] };
    const r = (await owner.post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`).send({ sales: [bad, good] }).expect(201)).body;
    expect(r.results.map((x: { status: string }) => x.status)).toEqual(['refused', 'created']);
  });
});
