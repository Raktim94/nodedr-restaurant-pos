/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies are untyped */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const run = process.env.MENU_PAUSE_E2E ? describe : describe.skip;

run('Temporary menu pauses', () => {
  let app: INestApplication<App>;
  let db: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let id: string;
  let qr: string;
  let session: string;
  let timezone: string;
  const branchId = randomUUID();
  const kiosk = randomUUID().replaceAll('-', '');
  const q = `?branchId=${branchId}`;
  const pause = () => `/api/v1/menu/items/${id}/pause`;
  const mobilePauses = '/api/v1/mobile/standalone/menu-pauses';
  const lines = () => [{ menuItemId: id, quantity: 1, modifierIds: [] }];
  const staffOrder = () =>
    owner.post(`/api/v1/orders${q}`).send({ type: 'TAKEAWAY', items: lines() });
  const guest = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(PrismaService);
    const actor = await db.user.findFirstOrThrow({
      where: { email: 'owner@demo.local' },
      include: { restaurant: true },
    });
    timezone = actor.restaurant.timezone;
    await db.branch.create({
      data: {
        id: branchId,
        restaurantId: actor.restaurantId,
        name: 'Pause test',
        kioskToken: kiosk,
      },
    });
    await db.userBranch.create({ data: { userId: actor.id, branchId } });
    const floor = await db.floor.create({ data: { branchId, name: 'Hall' } });
    qr = randomUUID();
    const table = await db.table.create({
      data: { floorId: floor.id, number: '1', qrToken: qr },
    });
    const cat = await db.menuCategory.create({
      data: { name: 'Lunch', branchId },
    });
    const item = await db.menuItem.create({
      data: {
        categoryId: cat.id,
        branchId,
        name: 'Lunch dish',
        price: 10,
        availableFrom: '06:00',
        availableTo: '22:00',
      },
    });
    id = item.id;
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const opened = await owner
      .post(`/api/v1/tables/${table.id}/session${q}`)
      .send({})
      .expect(201);
    const joined = await guest()
      .post(`/api/v1/public/menu/${qr}/session`)
      .send({ code: opened.body.code })
      .expect(201);
    session = joined.body.token;
  });
  afterAll(async () => {
    try {
      if (db) {
        await db.order.deleteMany({ where: { branchId } });
        await db.branch.deleteMany({ where: { id: branchId } });
      }
    } finally {
      await app?.close();
    }
  });

  it('refuses missing, ambiguous, and out-of-branch commands', async () => {
    await guest()
      .patch(pause() + q)
      .send({ minutes: 30 })
      .expect(401);
    await owner.patch(pause()).send({ minutes: 30 }).expect(400);
    await owner
      .patch(pause() + q)
      .send({ minutes: 30, resume: true })
      .expect(400);
    await owner
      .patch(pause() + '?branchId=demo-branch')
      .send({ minutes: 30 })
      .expect(404);
  });

  it('blocks new staff, QR and kiosk sales and extra rounds, and lets an existing bill settle', async () => {
    const bill = await staffOrder().expect(201);
    const before = Date.now();
    const paused = await owner
      .patch(pause() + q)
      .send({ minutes: 30 })
      .expect(200);
    const until = Date.parse(paused.body.pausedUntil as string);
    expect(until).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    expect(paused.body).toMatchObject({
      isActive: true,
      availableFrom: '06:00',
      availableTo: '22:00',
    });
    // A menu editor can submit an older copy while the kitchen is paused.
    await owner
      .patch(`/api/v1/menu/items/${id}${q}`)
      .send({ description: 'Fresh', pausedUntil: null })
      .expect(200);
    for (const path of [`menu/${qr}`, `kiosk/${kiosk}`]) {
      const { body } = await guest()
        .get('/api/v1/public/' + path)
        .expect(200);
      expect(body.timezone).toBe(timezone);
      expect(body.categories[0].items[0]).toMatchObject({
        id,
        pausedUntil: paused.body.pausedUntil,
      });
    }
    await owner
      .get(mobilePauses + q)
      .expect(200, [{ id, pausedUntil: paused.body.pausedUntil }]);
    const blocked = await Promise.all([
      staffOrder(),
      owner
        .post(`/api/v1/orders/${bill.body.id}/items${q}`)
        .send({ items: lines() }),
      guest()
        .post(`/api/v1/public/menu/${qr}/order`)
        .set('x-table-session', session)
        .send({ guestName: 'Guest', items: lines() }),
      guest().post(`/api/v1/public/kiosk/${kiosk}/order`).send({
        requestId: randomUUID(),
        serviceType: 'TAKEAWAY',
        items: lines(),
      }),
    ]);
    for (const res of blocked) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'ITEM_UNAVAILABLE',
        unavailableItemIds: [id],
        pausedItems: [{ id, pausedUntil: paused.body.pausedUntil }],
      });
    }
    await owner
      .post(`/api/v1/orders/${bill.body.id}/checkout${q}`)
      .send({ payments: [{ method: 'CASH', amount: 10 }] })
      .expect(201);
    const resumed = await owner
      .patch(pause() + q)
      .send({ resume: true })
      .expect(200);
    expect(resumed.body.pausedUntil).toBeNull();
    await owner.get(mobilePauses + q).expect(200, []);
    await staffOrder().expect(201);
  });

  it('syncs a completed phone sale when a pause was added after payment', async () => {
    const sale = {
      id: randomUUID(),
      localNumber: 'OFF-1',
      soldAt: new Date(Date.now() - 60_000).toISOString(),
      items: [{ menuItemId: id, quantity: 1, unitPrice: 10 }],
      payments: [{ method: 'CASH', amount: 10 }],
    };
    await owner
      .patch(pause() + q)
      .send({ minutes: 30 })
      .expect(200);
    const result = await owner
      .post('/api/v1/mobile/standalone/sales' + q)
      .send({ sales: [sale] })
      .expect(201);
    expect(result.body.results[0]).toMatchObject({
      id: sale.id,
      status: 'created',
    });
  });

  it('uses restaurant time, and accepts a sale immediately after expiry', async () => {
    const { body } = await owner
      .patch(pause() + q)
      .send({ localTime: '13:10' })
      .expect(200);
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(body.pausedUntil as string)),
    ).toBe('13:10');
    expect(Date.parse(body.pausedUntil as string)).toBeGreaterThan(Date.now());
    await db.menuItem.update({
      where: { id },
      data: { pausedUntil: new Date(Date.now() - 1) },
    });
    await staffOrder().expect(201);
    await db.menuItem.update({ where: { id }, data: { isActive: false } });
    await owner
      .patch(pause() + q)
      .send({ minutes: 30 })
      .expect(404);
    await owner
      .patch(pause() + q)
      .send({ resume: true })
      .expect(200);
    await staffOrder().expect(400);
  });
});
