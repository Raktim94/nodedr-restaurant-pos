/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Delivery riders: sign in to the normal app with phone number + password, duty, live location, own deliveries only.
//   RIDER_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand rider
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.RIDER_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = String(Date.now()).slice(-6);
const PHONE_A = `9${tag}111`;
const PHONE_B = `9${tag}222`;
const PIN = 'Rider-1234';

run('Rider app (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let a: ReturnType<typeof request.agent>;
  let b: ReturnType<typeof request.agent>;
  let riderAId: string;
  let token: string;
  let locationName: string;
  const http = () => request(app.getHttpServer());
  const login = (id: string, password: string) =>
    http().post('/api/v1/auth/login').send({ email: id, password });

  const newDelivery = async (n: number) => {
    const r = await http()
      .post('/api/v1/integrations/locations/' + BRANCH + '/orders')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        type: 'DELIVERY',
        customerName: `Rider Cust ${n}`,
        customerPhone: `9${tag}9${n}0`,
        delivery: { address: `${n} MG Road, Flat 4B`, pincode: '700001' },
        items: [{ menuItemId: 'demo-item-cola', quantity: 2 }],
      })
      .expect(201);
    return r.body.id as string;
  };

  beforeAll(async () => {
    // Simulate an install from before the rider app: the permission does not exist yet, so
    // booting must create it and give it to the delivery role (the upgrade path).
    const pre = new PrismaClient();
    await pre.permission.deleteMany({ where: { key: 'delivery.rider' } });
    await pre.$disconnect();
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
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    locationName = (
      await prisma.branch.findUniqueOrThrow({ where: { id: BRANCH } })
    ).name;
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const roleId = roles.find((r) => r.name === 'DELIVERY_STAFF')!.id;
    for (const [n, phone] of [
      ['A', PHONE_A],
      ['B', PHONE_B],
    ] as const) {
      await owner
        .post('/api/v1/users')
        .send({
          name: `Rider ${n} ${tag}`,
          email: `rider-${n}-${tag}@demo.local`,
          phone,
          password: PIN,
          roleId,
          branchIds: [BRANCH],
        })
        .expect(201);
    }
    riderAId = (
      await prisma.user.findFirstOrThrow({ where: { phone: PHONE_A } })
    ).id;
    token = (
      await owner
        .post('/api/v1/integration-api-keys')
        .send({
          name: `rider-${tag}`,
          scopes: ['orders:write', 'orders:read', 'locations:read'],
        })
        .expect(201)
    ).body.token;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: { guestName: { startsWith: 'Rider Cust' } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [PHONE_A, PHONE_B] } },
    });
    await prisma.integrationApiKey.deleteMany({
      where: { name: { endsWith: `-${tag}` } },
    });
    await app.close();
  });

  it('refuses an unknown ID or a wrong password with one message', async () => {
    const msgs = new Set<string>();
    for (const [id, pw] of [
      [`9${tag}000`, PIN],
      [PHONE_A, 'wrong-pin'],
      ['12345', PIN],
      ['nobody@nowhere.test', PIN],
    ] as const) {
      const r = await login(id, pw).expect(401);
      msgs.add(r.body.message);
    }
    expect(msgs.size).toBe(1);
  });

  it('signs in with the phone number as login ID (any format) and a password; the same ID works as email too', async () => {
    a = request.agent(app.getHttpServer());
    const r = await a
      .post('/api/v1/auth/login')
      .send({
        email: `+91 ${PHONE_A.slice(0, 5)}-${PHONE_A.slice(5)}`,
        password: PIN,
      })
      .expect(201);
    expect(r.body.user.roleName).toBe('DELIVERY_STAFF');
    expect(r.body.user.permissions).toContain('delivery.rider');
    const me = (await a.get('/api/v1/rider/me').expect(200)).body;
    expect(me.location.name).toBe(locationName);
    expect(me.online).toBe(false);
    b = request.agent(app.getHttpServer());
    await b
      .post('/api/v1/auth/login')
      .send({ email: PHONE_B, password: PIN })
      .expect(201);
    await login(`rider-A-${tag}@demo.local`, PIN).expect(201);
  });

  it('duty and live location: only an on-duty rider shares a position', async () => {
    expect(
      (
        await a
          .post('/api/v1/rider/location')
          .send({ lat: 22.57, lng: 88.36 })
          .expect(201)
      ).body.saved,
    ).toBe(false);
    await a
      .post('/api/v1/rider/location')
      .send({ lat: 123, lng: 0 })
      .expect(400);
    await a.post('/api/v1/rider/duty').send({ online: true }).expect(201);
    expect(
      (
        await a
          .post('/api/v1/rider/location')
          .send({ lat: 22.57, lng: 88.36 })
          .expect(201)
      ).body.saved,
    ).toBe(true);
    const drivers = (
      await owner.get(`/api/v1/delivery/drivers${q}`).expect(200)
    ).body as any[];
    const d = drivers.find((x) => x.id === riderAId);
    expect(d.riderOnline).toBe(true);
    expect(d.riderLat).toBeCloseTo(22.57);
    expect(d.activeDeliveries).toBe(0);
  });

  let orderId: string;
  it('a delivery assigned by staff shows up for that rider only, with what they need', async () => {
    orderId = await newDelivery(1);
    await owner
      .patch(`/api/v1/delivery/${orderId}/assign${q}`)
      .send({ driverId: riderAId })
      .expect(200);
    const mine = (await a.get('/api/v1/rider/deliveries').expect(200)).body;
    expect(mine.active).toHaveLength(1);
    const c = mine.active[0];
    expect(c.id).toBe(orderId);
    expect(c.status).toBe('ASSIGNED');
    expect(c.address).toContain('MG Road');
    expect(c.customer.phone).toBeTruthy();
    expect(c.items[0].quantity).toBe(2);
    expect(c.amountToCollect).toBeGreaterThan(0);
    expect(c.pickup.name).toBe(locationName);
    expect(c).not.toHaveProperty('createdById');
    expect(
      (await b.get('/api/v1/rider/deliveries').expect(200)).body.active,
    ).toHaveLength(0);
    await b
      .patch(`/api/v1/rider/deliveries/${orderId}/status`)
      .send({ status: 'PICKED_UP' })
      .expect(404);
  });

  it('follows the real order: cannot deliver before pickup, failure needs a reason, cannot go offline mid-delivery', async () => {
    const s = (status: string, reason?: string) =>
      a
        .patch(`/api/v1/rider/deliveries/${orderId}/status`)
        .send({ status, reason });
    await s('DELIVERED').expect(400);
    await a.post('/api/v1/rider/duty').send({ online: false }).expect(409);
    expect((await s('PICKED_UP').expect(200)).body.status).toBe('PICKED_UP');
    await s('FAILED').expect(400);
    const done = (await s('DELIVERED').expect(200)).body;
    expect(done.status).toBe('DELIVERED');
    const row = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(row.pickedUpAt).toBeTruthy();
    expect(row.assignedAt).toBeTruthy();
    expect(row.deliveredAt).toBeTruthy();
    const list = (await a.get('/api/v1/rider/deliveries').expect(200)).body;
    expect(list.active).toHaveLength(0);
    expect(list.done[0].id).toBe(orderId);
    expect(
      (await a.get('/api/v1/rider/me').expect(200)).body.today.delivered,
    ).toBeGreaterThanOrEqual(1);
  });

  it('records why a delivery failed', async () => {
    const id = await newDelivery(2);
    await owner
      .patch(`/api/v1/delivery/${id}/assign${q}`)
      .send({ driverId: riderAId })
      .expect(200);
    await a
      .patch(`/api/v1/rider/deliveries/${id}/status`)
      .send({ status: 'PICKED_UP' })
      .expect(200);
    await a
      .patch(`/api/v1/rider/deliveries/${id}/status`)
      .send({ status: 'FAILED', reason: 'Customer not reachable' })
      .expect(200);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id } }))
        .deliveryFailedReason,
    ).toBe('Customer not reachable');
  });

  it('can go offline once nothing is active, and needs a session for any rider route', async () => {
    await a.post('/api/v1/rider/duty').send({ online: false }).expect(201);
    await http().get('/api/v1/rider/deliveries').expect(401);
    await http()
      .post('/api/v1/rider/location')
      .send({ lat: 1, lng: 1 })
      .expect(401);
  });
});
