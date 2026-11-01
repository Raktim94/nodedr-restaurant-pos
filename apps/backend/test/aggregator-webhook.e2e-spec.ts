/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped by design */
// Zomato / Swiggy / aggregator inbound webhook: signature, replay, idempotency, honest status.
//   AGG_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand aggregator-webhook
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { signAggregatorBody } from './../src/integration-hub/aggregator-orders.service';
import { PrismaService } from './../src/prisma/prisma.service';

process.env.ALLOW_PUBLIC_SIGNUP = 'true';
const run = process.env.AGG_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);
const SECRET = `whsec_${tag}_0123456789abcdef`;
const H = '/api/v1/integration-hub';

run('Aggregator webhook (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let restaurantId: string;
  let item: { id: string; name: string };
  let url: string;

  const post = (
    body: unknown,
    opts: { secret?: string; ts?: number; sig?: string; path?: string } = {},
  ) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    return request(app.getHttpServer())
      .post(opts.path ?? url)
      .set('Content-Type', 'application/json')
      .set('X-OrderRestro-Timestamp', ts)
      .set(
        'X-OrderRestro-Signature',
        opts.sig ?? signAggregatorBody(opts.secret ?? SECRET, ts, raw),
      )
      .send(raw);
  };
  const order = (id: string, extra: Record<string, unknown> = {}) => ({
    event: 'order.created',
    orderId: id,
    branchId: 'demo-branch',
    paymentMode: 'PREPAID',
    customer: { name: 'Asha', phone: '9876500011', ref: 'zc-1' },
    delivery: { address: '12 MG Road', pincode: '560001' },
    items: [{ name: item.name.toUpperCase(), quantity: 2 }],
    ...extra,
  });
  const status = async () =>
    ((await owner.get(H).expect(200)).body as any[]).find(
      (p) => p.key === 'zomato',
    ).connection?.status;

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
    app = mod.createNestApplication({ rawBody: true });
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
      await prisma.branch.findUniqueOrThrow({ where: { id: 'demo-branch' } })
    ).restaurantId;
    await prisma.integrationConnection.deleteMany({
      where: { restaurantId, provider: 'zomato' },
    });
    item = await prisma.menuItem.findFirstOrThrow({
      where: { branchId: 'demo-branch', category: { showOnWebsite: true } },
      select: { id: true, name: true },
    });
    url = `${H}/webhook/${restaurantId}/zomato`;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: { externalSource: 'zomato', externalOrderId: { contains: tag } },
    });
    await prisma.integrationConnection.deleteMany({
      where: { restaurantId, provider: 'zomato' },
    });
    await app.close();
  });

  it('is refused while nothing is set up, and lists the webhook path', async () => {
    await post({ event: 'ping' }).expect(401);
    const z = ((await owner.get(H).expect(200)).body as any[]).find(
      (p) => p.key === 'zomato',
    );
    expect(z.capabilities.receiveOrders).toBe(true);
    expect(z.webhookPath).toBe(url);
    expect(z.credentialFields.map((f: any) => f.key)).toEqual([
      'webhookSecret',
    ]);
  });

  it('rejects a too-short secret, then saves a good one without claiming Connected', async () => {
    await owner
      .put(`${H}/zomato`)
      .send({ credentials: { webhookSecret: 'short' } })
      .expect(400);
    await owner
      .put(`${H}/zomato`)
      .send({ credentials: { webhookSecret: SECRET } })
      .expect(200);
    expect(await status()).toBe('PENDING_CONFIGURATION');
    const t = await owner.post(`${H}/zomato/test`).expect(201);
    expect(t.body.ok).toBe(false);
    expect(await status()).toBe('PENDING_CONFIGURATION');
  });

  it('refuses a wrong signature, a wrong secret, a stale timestamp and a tampered body', async () => {
    await post({ event: 'ping' }, { sig: 'sha256=00' }).expect(401);
    await post({ event: 'ping' }, { secret: 'x'.repeat(20) }).expect(401);
    await post(
      { event: 'ping' },
      { ts: Math.floor(Date.now() / 1000) - 3600 },
    ).expect(401);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signAggregatorBody(SECRET, ts, '{"event":"ping"}');
    await request(app.getHttpServer())
      .post(url)
      .set('Content-Type', 'application/json')
      .set('X-OrderRestro-Timestamp', ts)
      .set('X-OrderRestro-Signature', sig)
      .send('{"event":"ping" }')
      .expect(401);
    expect(await status()).toBe('PENDING_CONFIGURATION');
  });

  it('a signed ping is what turns the integration Connected', async () => {
    await post({ event: 'ping' }).expect(200);
    expect(await status()).toBe('CONNECTED');
  });

  it('creates an online order awaiting acceptance, once, however often it is delivered', async () => {
    const id = `ZOM-${tag}-1`;
    const first = await post(order(id)).expect(200);
    expect(first.body.duplicate).toBe(false);
    const again = await post(order(id)).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.orderId).toBe(first.body.orderId);

    const rows = await prisma.order.findMany({
      where: { externalSource: 'zomato', externalOrderId: id },
      include: { items: true },
    });
    expect(rows).toHaveLength(1);
    const o = rows[0];
    expect(o.channel).toBe('ONLINE');
    expect(o.acceptance).toBe('PENDING');
    expect(o.type).toBe('DELIVERY');
    expect(o.externalCustomerRef).toBe('zc-1');
    expect(o.deliveryAddress).toBe('12 MG Road');
    expect(o.notes).toContain('Zomato');
    expect(o.notes).toContain('PAID online');
    expect(o.items[0].quantity).toBe(2);
    expect(Number(o.subtotal)).toBeGreaterThan(0);
  });

  it('ignores any price the platform sends (menu prices win)', async () => {
    const id = `ZOM-${tag}-price`;
    await post(
      order(id, {
        items: [{ name: item.name, quantity: 1, price: 0.01, total: 0.01 }],
        total: 0.01,
      }),
    ).expect(200);
    const o = await prisma.order.findFirstOrThrow({
      where: { externalSource: 'zomato', externalOrderId: id },
    });
    expect(Number(o.subtotal)).toBeGreaterThan(1);
  });

  it('refuses a whole order with an unknown dish, creating nothing', async () => {
    const id = `ZOM-${tag}-bad`;
    const r = await post(
      order(id, { items: [{ name: 'Nonexistent dish', quantity: 1 }] }),
    ).expect(422);
    expect(JSON.stringify(r.body)).toContain('Nonexistent dish');
    expect(await prisma.order.count({ where: { externalOrderId: id } })).toBe(
      0,
    );
  });

  it('needs a branchId when the restaurant has several branches', async () => {
    const extra = await prisma.branch.create({
      data: { restaurantId, name: `Second ${tag}` },
    });
    try {
      const r = await post(
        order(`ZOM-${tag}-amb`, { branchId: undefined }),
      ).expect(422);
      expect(JSON.stringify(r.body)).toContain('branchId');
      await post(order(`ZOM-${tag}-amb`, { branchId: 'not-mine' })).expect(422);
    } finally {
      await prisma.branch.delete({ where: { id: extra.id } });
    }
  });

  it('rejects malformed payloads with 400', async () => {
    await post({ event: 'order.created', orderId: 'x' }).expect(400);
    await post('not json').expect(400);
  });

  it('a platform cancellation declines an order still awaiting acceptance', async () => {
    const id = `ZOM-${tag}-cancel`;
    await post(order(id)).expect(200);
    const r = await post({ event: 'order.cancelled', orderId: id }).expect(200);
    expect(r.body.cancelled).toBe(true);
    const o = await prisma.order.findFirstOrThrow({
      where: { externalSource: 'zomato', externalOrderId: id },
    });
    expect(o.status).toBe('CANCELLED');
    await post({ event: 'order.cancelled', orderId: 'nope' }).expect(404);
  });

  it('is isolated per restaurant and per provider, and stops when disabled', async () => {
    await post(
      { event: 'ping' },
      { path: `${H}/webhook/${restaurantId}/swiggy` },
    ).expect(401);
    await post(
      { event: 'ping' },
      { path: `${H}/webhook/other-restaurant/zomato` },
    ).expect(401);
    await owner
      .post(`${H}/zomato/enabled`)
      .send({ enabled: false })
      .expect(201);
    await post({ event: 'ping' }).expect(401);
    await owner.post(`${H}/zomato/enabled`).send({ enabled: true }).expect(201);
    expect(await status()).toBe('PENDING_CONFIGURATION'); // re-enabling does not assume it still works
  });

  it('never exposes the secret and records activity', async () => {
    const list = JSON.stringify((await owner.get(H).expect(200)).body);
    expect(list).not.toContain(SECRET);
    const logs = (await owner.get(`${H}/zomato/logs`).expect(200))
      .body as any[];
    const events = logs.map((l) => l.event);
    expect(events).toEqual(
      expect.arrayContaining([
        'order_received',
        'webhook_rejected',
        'order_failed',
      ]),
    );
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });
});
