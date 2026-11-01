/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Website price change (cheaper / costlier, % or amount) and the customer's shared location.
//   PRICING_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand online-pricing
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.PRICING_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const API = `/api/v1/integrations/locations/${BRANCH}`;
const tag = String(Date.now()).slice(-6);

run('Website pricing and location (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let token: string;
  let restaurantId: string;
  let base: number;
  let original: any;
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const settings = (b: object) =>
    owner.patch('/api/v1/settings/restaurant').send(b);
  const menuPrice = async () => {
    const m = (await http().get(`${API}/menu`).set(auth()).expect(200)).body;
    for (const c of m.categories) {
      const it = c.items.find((i: any) => i.id === 'demo-item-cola');
      if (it) return Number(it.price);
    }
    throw new Error('cola not on the website menu');
  };
  const place = (n: number, delivery: object = {}, qty = 2) =>
    http()
      .post(`${API}/orders`)
      .set(auth())
      .send({
        type: 'DELIVERY',
        customerName: `Price Cust ${n}`,
        customerPhone: `9${tag}8${n}0`,
        delivery: {
          address: `${n} MG Road, Flat 4B`,
          pincode: '700001',
          ...delivery,
        },
        items: [{ menuItemId: 'demo-item-cola', quantity: qty }],
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
    restaurantId = (
      await prisma.branch.findUniqueOrThrow({ where: { id: BRANCH } })
    ).restaurantId;
    original = await prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });
    await settings({
      onlinePriceAdjustValue: 0,
      onlineMinOrderAmount: 0,
    }).expect(200);
    token = (
      await owner
        .post('/api/v1/integration-api-keys')
        .send({
          name: `price-${tag}`,
          scopes: [
            'orders:write',
            'orders:read',
            'menu:read',
            'orders:read_customer',
          ],
        })
        .expect(201)
    ).body.token;
    base = await menuPrice();
  });

  afterAll(async () => {
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        onlinePriceAdjustKind: original.onlinePriceAdjustKind,
        onlinePriceAdjustValue: original.onlinePriceAdjustValue,
        onlineMinOrderAmount: original.onlineMinOrderAmount,
      },
    });
    await prisma.order.deleteMany({
      where: { guestName: { startsWith: 'Price Cust' } },
    });
    await prisma.integrationApiKey.deleteMany({
      where: { name: { endsWith: `-${tag}` } },
    });
    await app.close();
  });

  it('is off by default: menu and orders use the normal price', async () => {
    expect(base).toBeGreaterThan(0);
    const o = await place(1).expect(201);
    expect(o.body.totals.subtotal).toBeCloseTo(base * 2, 2);
  });

  it('validates the setting', async () => {
    await settings({ onlinePriceAdjustKind: 'FREE' }).expect(400);
    await settings({ onlinePriceAdjustValue: 'abc' }).expect(400);
  });

  it('percentage cheaper: the menu and the order both drop, together', async () => {
    await settings({
      onlinePriceAdjustKind: 'PERCENT',
      onlinePriceAdjustValue: -10,
    }).expect(200);
    const shown = await menuPrice();
    expect(shown).toBeCloseTo(base * 0.9, 2);
    const o = await place(2).expect(201);
    expect(o.body.totals.subtotal).toBeCloseTo(shown * 2, 2);
  });

  it('percentage costlier and amount modes', async () => {
    await settings({
      onlinePriceAdjustKind: 'PERCENT',
      onlinePriceAdjustValue: 25,
    }).expect(200);
    expect(await menuPrice()).toBeCloseTo(base * 1.25, 2);
    await settings({
      onlinePriceAdjustKind: 'AMOUNT',
      onlinePriceAdjustValue: 5,
    }).expect(200);
    const up = await menuPrice();
    expect(up).toBeCloseTo(base + 5, 2);
    expect((await place(3).expect(201)).body.totals.subtotal).toBeCloseTo(
      up * 2,
      2,
    );
    await settings({
      onlinePriceAdjustKind: 'AMOUNT',
      onlinePriceAdjustValue: -5,
    }).expect(200);
    expect(await menuPrice()).toBeCloseTo(base - 5, 2);
  });

  it('never goes below zero', async () => {
    await settings({
      onlinePriceAdjustKind: 'AMOUNT',
      onlinePriceAdjustValue: -100000,
    }).expect(200);
    expect(await menuPrice()).toBe(0);
  });

  it('does not touch what staff charge in the restaurant', async () => {
    await settings({
      onlinePriceAdjustKind: 'PERCENT',
      onlinePriceAdjustValue: -50,
    }).expect(200);
    const staff = await owner
      .post(`/api/v1/orders?branchId=${BRANCH}`)
      .send({
        type: 'TAKEAWAY',
        items: [{ menuItemId: 'demo-item-cola', quantity: 2 }],
      })
      .expect(201);
    expect(Number(staff.body.subtotal)).toBeCloseTo(base * 2, 2);
    await prisma.order
      .delete({ where: { id: staff.body.id } })
      .catch(() => undefined);
  });

  it('the online minimum is measured on the adjusted price', async () => {
    await settings({
      onlinePriceAdjustKind: 'PERCENT',
      onlinePriceAdjustValue: -50,
      onlineMinOrderAmount: base * 2,
    }).expect(200);
    await place(4, {}, 2).expect(400); // 2 x 0.5*base < 2*base
    await place(4, {}, 5).expect(201); // 5 x 0.5*base >= 2*base
    await settings({
      onlinePriceAdjustValue: 0,
      onlineMinOrderAmount: 0,
    }).expect(200);
  });

  it('keeps the customer shared position and place with the order, and returns them with customer details', async () => {
    const o = await place(5, {
      lat: 22.5726,
      lng: 88.3639,
      place: 'Near Hanuman Mandir, gate 2',
    }).expect(201);
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: o.body.id },
    });
    expect(row.deliveryLat).toBeCloseTo(22.5726, 4);
    expect(row.deliveryLng).toBeCloseTo(88.3639, 4);
    expect(row.deliveryPlace).toBe('Near Hanuman Mandir, gate 2');
    const full = await http()
      .get(`${API}/orders/${o.body.id}?include=customer`)
      .set(auth())
      .expect(200);
    expect(full.body.delivery.lat).toBeCloseTo(22.5726, 4);
    expect(full.body.delivery.place).toContain('Hanuman');
  });

  it('refuses nonsense positions', async () => {
    await place(6, { lat: 123, lng: 10 }).expect(400);
    await place(6, { lat: 12 }).expect(400);
    await place(6, { lat: 'x', lng: 1 }).expect(400);
    // a place name on its own (no GPS) is fine
    await place(6, { place: 'Opposite the post office' }).expect(201);
  });
});
