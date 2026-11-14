/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
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
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
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
    const s = (
      await owner
        .get(`/api/v1/mobile/standalone/snapshot?branchId=${branchId}`)
        .expect(200)
    ).body;
    expect(s.branch.id).toBe(branchId);
    expect(s.items.length).toBeGreaterThan(0);
    expect(s.items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        price: expect.any(Number),
        taxRate: expect.any(Number),
      }),
    );
    expect(s.categories.length).toBeGreaterThan(0);
    expect(s.restaurant.currency).toBeTruthy();
    expect(Array.isArray(s.floors)).toBe(true);
  });

  it('is closed to someone who is not signed in', async () => {
    await http()
      .get(`/api/v1/mobile/standalone/snapshot?branchId=${branchId}`)
      .expect(401);
    await http()
      .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
      .send({ sales: [] })
      .expect(401);
  });

  it('records an offline sale at the price the customer paid, once', async () => {
    const sale = {
      ...saleBase(1),
      items: [{ menuItemId: itemId, quantity: 2, unitPrice: 77 }],
      payments: [{ method: 'CASH', amount: 154, tendered: 200 }],
    };
    const first = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ deviceName: 'Test phone', sales: [sale] })
        .expect(201)
    ).body;
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
    const again = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body;
    expect(again.results[0]).toEqual(
      expect.objectContaining({ status: 'duplicate', orderId: order.id }),
    );
    expect(
      await prisma.order.count({
        where: { branchId, clientRequestId: sale.id },
      }),
    ).toBe(1);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(
      1,
    );
  });

  it("does not trust the phone's clock: a far-future sale is booked now and flagged, an ancient one is refused", async () => {
    const send = async (n: number, soldAt: string) =>
      (
        await owner
          .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
          .send({
            sales: [
              {
                ...saleBase(n),
                soldAt,
                items: [{ menuItemId: itemId, quantity: 1, unitPrice: 50 }],
                payments: [{ method: 'CASH', amount: 50 }],
              },
            ],
          })
          .expect(201)
      ).body.results[0];

    const future = await send(
      901,
      new Date(Date.now() + 5 * 86_400_000).toISOString(),
    );
    expect(future.status).toBe('created');
    const o = await prisma.order.findFirstOrThrow({
      where: { branchId, clientRequestId: `offline-${tag}-901` },
    });
    expect(o.createdAt.getTime()).toBeLessThan(Date.now() + 60_000);
    expect(o.notes).toMatch(/clock was ahead/);

    const old = await send(
      902,
      new Date(Date.now() - 400 * 86_400_000).toISOString(),
    );
    expect(old.status).toBe('refused');
    expect(old.code).toBe('SALE_TOO_OLD');
    expect(
      await prisma.order.count({
        where: { branchId, clientRequestId: `offline-${tag}-902` },
      }),
    ).toBe(0);
  });

  it('applies a discount and a UPI payment', async () => {
    const sale = {
      ...saleBase(2),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: 100 }],
      discountPercent: 10,
      payments: [{ method: 'UPI', amount: 90, reference: 'UPI123' }],
    };
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body;
    expect(r.results[0].status).toBe('created');
    const order = await prisma.order.findFirstOrThrow({
      where: { branchId, clientRequestId: sale.id },
    });
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
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body;
    expect(r.results[0].status).toBe('refused');
    const order = await prisma.order.findFirstOrThrow({
      where: { branchId, clientRequestId: sale.id },
    });
    expect(order.status).toBe('CANCELLED');
  });

  it('refuses a dish that is not on this branch menu, without stopping the others', async () => {
    const good = {
      ...saleBase(4),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: 50 }],
      payments: [{ method: 'CASH', amount: 50 }],
    };
    const bad = {
      ...saleBase(5),
      items: [{ menuItemId: 'not-a-real-dish', quantity: 1, unitPrice: 50 }],
      payments: [{ method: 'CASH', amount: 50 }],
    };
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [bad, good] })
        .expect(201)
    ).body;
    expect(r.results.map((x: { status: string }) => x.status)).toEqual([
      'refused',
      'created',
    ]);
    expect(r.results[0].code).toBe('ITEM_UNAVAILABLE');
  });

  it('flags a sale charged at a price that is not the menu price, and keeps what the customer paid', async () => {
    const live = Number(
      (await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } }))
        .price,
    );
    const sale = {
      ...saleBase(6),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: live + 13 }],
      payments: [{ method: 'CASH', amount: live + 13 }],
    };
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body.results[0];
    expect(r.status).toBe('created');
    expect(r.review).toEqual([
      expect.objectContaining({
        type: 'PRICE_CHANGED',
        menuItemId: itemId,
        phonePrice: live + 13,
        serverPrice: live,
      }),
    ]);
    const order = await prisma.order.findFirstOrThrow({
      where: { branchId, clientRequestId: sale.id },
    });
    expect(Number(order.totalAmount)).toBe(live + 13);
    expect(order.notes).toContain('[Review:');
    // A resend answers 'duplicate' and does not change the order.
    const again = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body.results[0];
    expect(again.status).toBe('duplicate');
  });

  it('does not flag a sale at the current menu price', async () => {
    const live = Number(
      (await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } }))
        .price,
    );
    const sale = {
      ...saleBase(7),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: live }],
      payments: [{ method: 'CASH', amount: live }],
    };
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body.results[0];
    expect(r.status).toBe('created');
    expect(r.review).toBeUndefined();
  });

  it('refuses a dish switched off on the server, then accepts the same sale once it is back (retry)', async () => {
    const live = Number(
      (await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } }))
        .price,
    );
    const sale = {
      ...saleBase(8),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: live }],
      payments: [{ method: 'CASH', amount: live }],
    };
    await prisma.menuItem.update({
      where: { id: itemId },
      data: { isActive: false },
    });
    try {
      const r = (
        await owner
          .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
          .send({ sales: [sale] })
          .expect(201)
      ).body.results[0];
      expect(r).toEqual(
        expect.objectContaining({
          status: 'refused',
          code: 'ITEM_UNAVAILABLE',
        }),
      );
      expect(
        await prisma.order.count({
          where: { branchId, clientRequestId: sale.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.menuItem.update({
        where: { id: itemId },
        data: { isActive: true },
      });
    }
    const retried = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body.results[0];
    expect(retried.status).toBe('created');
    expect(
      await prisma.order.count({
        where: { branchId, clientRequestId: sale.id },
      }),
    ).toBe(1);
  });

  it('refuses one dish sold at two prices in a sale with the right code', async () => {
    const sale = {
      ...saleBase(9),
      items: [
        { menuItemId: itemId, quantity: 1, unitPrice: 10 },
        { menuItemId: itemId, quantity: 1, unitPrice: 20 },
      ],
      payments: [{ method: 'CASH', amount: 30 }],
    };
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body.results[0];
    expect(r).toEqual(
      expect.objectContaining({ status: 'refused', code: 'PRICE_CONFLICT' }),
    );
  });

  it('says who it is without signing in, and nothing about the restaurant', async () => {
    const info = (await http().get('/api/v1/mobile/server-info').expect(200))
      .body;
    expect(info).toEqual(
      expect.objectContaining({
        product: 'orderrestro',
        apiVersion: 2,
        version: expect.any(String),
      }),
    );
    expect(info.capabilities).toEqual(
      expect.objectContaining({
        standaloneSalesSync: true,
        saleConflictCodes: true,
      }),
    );
    expect(JSON.stringify(info)).not.toMatch(/demo|restaurant/i);
  });

  it('refuses a payment that fails checkout with the payment code', async () => {
    const sale = {
      ...saleBase(10),
      items: [{ menuItemId: itemId, quantity: 1, unitPrice: 100 }],
      payments: [{ method: 'CASH', amount: 40 }],
    };
    const r = (
      await owner
        .post(`/api/v1/mobile/standalone/sales?branchId=${branchId}`)
        .send({ sales: [sale] })
        .expect(201)
    ).body.results[0];
    expect(r).toEqual(
      expect.objectContaining({ status: 'refused', code: 'PAYMENT_REJECTED' }),
    );
  });
});
