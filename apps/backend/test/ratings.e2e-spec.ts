/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
//   RATINGS_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand ratings
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.RATINGS_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);

run('Customer ratings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let chef: ReturnType<typeof request.agent>;
  let guest: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemId: string;
  let table: { id: string; qr: string; tok: string };

  const place = async () => {
    const r = await guest.post(`/api/v1/public/menu/${table.qr}/order`).set('x-table-session', table.tok).send({ guestName: 'Asha', items: [{ menuItemId: itemId, quantity: 1, modifierIds: [] }] }).expect(201);
    return r.body as { id: string; ratingToken: string };
  };
  const pay = async (orderId: string) => {
    const o = (await owner.get(`/api/v1/orders/${orderId}${q}`).expect(200)).body;
    await owner.post(`/api/v1/orders/${orderId}/checkout${q}`).send({ payments: [{ method: 'CASH', amount: Number(o.totalAmount) }] }).expect(201);
  };
  const rate = (token: string, stars: number, comment?: string) => guest.post('/api/v1/public/ratings').send({ token, stars, comment });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const email = `chef-${tag}@demo.local`;
    await owner.post('/api/v1/users').send({ name: `Chef ${tag}`, email, password: 'Password123!', roleId: roles.find((r) => r.name === 'CHEF')!.id, branchIds: [BRANCH] }).expect(201);
    chef = request.agent(app.getHttpServer());
    await chef.post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(201);
    guest = request.agent(app.getHttpServer());
    floorId = (await owner.post(`/api/v1/tables/floors${q}`).send({ name: `Rate ${tag}` }).expect(201)).body.id;
    const t = (await owner.post(`/api/v1/tables${q}`).send({ floorId, number: `R-${tag}`, capacity: 2 }).expect(201)).body;
    const qr = (await owner.post(`/api/v1/tables/${t.id}/qr-token${q}`).expect(201)).body.qrToken as string;
    const code = (await owner.post(`/api/v1/tables/${t.id}/session${q}`).send({}).expect(201)).body.code as string;
    table = { id: t.id, qr, tok: (await guest.post(`/api/v1/public/menu/${qr}/session`).send({ code }).expect(201)).body.token };
    const dishes = (await owner.get(`/api/v1/menu/items${q}`).expect(200)).body as { id: string; name: string }[];
    itemId = (dishes.find((d) => d.name === 'Coca-Cola') ?? dishes.find((d) => d.name.startsWith('PlainItem')) ?? dishes[0]).id;
  });
  afterAll(async () => {
    await prisma.floor.deleteMany({ where: { id: floorId } });
    await app.close();
  });

  it('the order response carries a rating token, and it reveals no secret', async () => {
    const o = await place();
    expect(o.ratingToken.split('.')).toHaveLength(2);
    expect(o.ratingToken).not.toMatch(/JWT|secret/i);
    expect((await guest.get(`/api/v1/public/ratings/status?token=${encodeURIComponent(o.ratingToken)}`).expect(200)).body).toEqual({ eligible: false, rated: false, paid: false });
    (table as { open?: typeof o }).open = o;
  });

  it('an order that is not complete and paid cannot be rated', async () => {
    const o = (table as { open?: { ratingToken: string } }).open!;
    const r = await rate(o.ratingToken, 5, 'lovely');
    expect(r.status).toBe(400);
    expect(await prisma.orderRating.count({ where: { branchId: BRANCH, comment: 'lovely' } })).toBe(0);
  });

  it('after payment the guest can rate once, with a cleaned comment; a second try is refused', async () => {
    const o = (table as { open?: { id: string; ratingToken: string } }).open!;
    await pay(o.id);
    expect((await guest.get(`/api/v1/public/ratings/status?token=${encodeURIComponent(o.ratingToken)}`).expect(200)).body.eligible).toBe(true);
    await rate(o.ratingToken, 5, '  <script>alert(1)</script> Great\u0007 food!!  \n\n Thanks ').expect(201);
    const row = await prisma.orderRating.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(row.comment).toBe('alert(1) Great food!! Thanks');
    expect(row.stars).toBe(5);
    const again = await rate(o.ratingToken, 1, 'changed my mind');
    expect(again.status).toBe(409);
    expect(await prisma.orderRating.count({ where: { orderId: o.id } })).toBe(1);
    expect((await guest.get(`/api/v1/public/ratings/status?token=${encodeURIComponent(o.ratingToken)}`).expect(200)).body).toEqual({ eligible: false, rated: true, paid: true });
  });

  it('forged, tampered, expired, malformed and moved tokens are refused', async () => {
    const real = (table as { open?: { id: string; ratingToken: string } }).open!;
    const [payload] = real.ratingToken.split('.');
    expect((await rate('x'.repeat(40), 5)).status).toBe(403);
    expect((await rate(`${payload}.AAAA`, 5)).status).toBe(403); // right payload, wrong signature
    const otherPayload = Buffer.from(`some-other-order.${Date.now() + 1e9}`).toString('base64url');
    expect((await rate(`${otherPayload}.${payload.slice(0, 20)}`, 5)).status).toBe(403); // signature from another payload
    const secret = `${process.env.JWT_SECRET}:order-rating`;
    const expired = Buffer.from(`${real.id}.${Date.now() - 1000}`).toString('base64url');
    const sig = createHmac('sha256', secret).update(expired).digest('base64url');
    const exp = await rate(`${expired}.${sig}`, 5);
    expect(exp.status).toBe(403);
    expect(exp.body.message).toMatch(/expired/);
    expect((await guest.post('/api/v1/public/ratings').send({ stars: 5 })).status).toBe(400);
  });

  it('stars outside 1 to 5 are refused', async () => {
    // paying the first order cleared the table and closed its session: the next guests need a fresh code
    const code = (await owner.post(`/api/v1/tables/${table.id}/session${q}`).send({}).expect(201)).body.code as string;
    table.tok = (await guest.post(`/api/v1/public/menu/${table.qr}/session`).send({ code }).expect(201)).body.token;
    const o = await place();
    await pay(o.id);
    for (const s of [0, 6, -1, 2.5]) expect((await rate(o.ratingToken, s)).status).toBe(400);
    await rate(o.ratingToken, 3).expect(201);
  });

  it('only people with the ratings permission can read feedback; the list and average come from what was stored', async () => {
    expect((await guest.get(`/api/v1/ratings${q}`)).status).toBe(401);
    expect((await chef.get(`/api/v1/ratings${q}`)).status).toBe(403);
    const r = (await owner.get(`/api/v1/ratings${q}`).expect(200)).body;
    expect(r.count).toBeGreaterThanOrEqual(2);
    expect(r.average).toBeGreaterThan(0);
    expect(r.distribution).toHaveLength(5);
    expect(r.items.find((i: { comment: string }) => i.comment === 'alert(1) Great food!! Thanks')).toBeTruthy();
  });
});
