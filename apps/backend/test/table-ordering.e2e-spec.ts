/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Table self-ordering, kitchen release, paging buzzers and the customer display against a real Postgres.
//   TABLE_ORDER_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand table-ordering
import { createHmac, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.TABLE_ORDER_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);

run('Table ordering, paging and customer display (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let guest: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemId: string;
  const tables: Record<string, { id: string; qr: string }> = {};
  let hook: Server;
  const hits: { sig?: string; body: string }[] = [];

  const mkTable = async (n: string) => {
    const t = (await owner.post(`/api/v1/tables${q}`).send({ floorId, number: `${n}-${tag}`, capacity: 2 }).expect(201)).body;
    const qr = (await owner.post(`/api/v1/tables/${t.id}/qr-token${q}`).expect(201)).body.qrToken as string;
    tables[n] = { id: t.id, qr };
  };
  const order = (n: string, extra: object = {}, items = 1) =>
    guest.post(`/api/v1/public/menu/${tables[n].qr}/order`).send({ guestName: 'Asha', items: [{ menuItemId: itemId, quantity: items, modifierIds: [] }], ...extra });
  const kotCount = (orderId: string) => prisma.kot.count({ where: { orderId } });

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
    const email = `till-${tag}@demo.local`;
    await owner.post('/api/v1/users').send({ name: `Till ${tag}`, email, password: 'Password123!', roleId: roles.find((r) => r.name === 'CASHIER')!.id, branchIds: [BRANCH] }).expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier.post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(201);
    guest = request.agent(app.getHttpServer()); // never signs in
    floorId = (await owner.post(`/api/v1/tables/floors${q}`).send({ name: `Hall ${tag}` }).expect(201)).body.id;
    for (const n of ['A', 'B', 'C']) await mkTable(n);
    // a dish with no required options, so the guest can order it with one tap
    const dishes = (await owner.get(`/api/v1/menu/items${q}`).expect(200)).body as { id: string; name: string }[];
    itemId = (dishes.find((d) => d.name === 'Coca-Cola') ?? dishes.find((d) => d.name.startsWith('PlainItem')) ?? dishes[0]).id;
    hook = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => { hits.push({ sig: req.headers['x-orderrestro-signature'] as string, body: b }); res.statusCode = 200; res.end('ok'); });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
  });
  afterAll(async () => {
    hook.close();
    await prisma.floor.deleteMany({ where: { id: floorId } });
    await prisma.buzzer.deleteMany({ where: { name: { contains: tag } } });
    await prisma.displayTerminal.deleteMany({ where: { name: { contains: tag } } });
    await app.close();
  });

  // ---- the guest's order --------------------------------------------------------------------------

  it('the web menu says which payments are possible; online is offered only when a gateway is on', async () => {
    const m = (await guest.get(`/api/v1/public/menu/${tables.A.qr}`).expect(200)).body;
    expect(m.payments).toEqual({ cash: true, online: false });
  });

  it('refuses "pay on my phone" when no gateway is switched on, and creates nothing', async () => {
    const before = await prisma.order.count({ where: { tableId: tables.C.id } });
    const r = await order('C', { payment: 'ONLINE', idempotencyKey: `k-${randomUUID()}` });
    expect(r.status).toBe(400);
    expect(await prisma.order.count({ where: { tableId: tables.C.id } })).toBe(before);
  });

  it('a cash order goes to the kitchen at once and stays UNPAID until staff record the cash; a resend makes no second order', async () => {
    const key = `k-${randomUUID()}`;
    const a = (await order('A', { payment: 'CASH', idempotencyKey: key }).expect(201)).body;
    const b = (await order('A', { payment: 'CASH', idempotencyKey: key }).expect(201)).body;
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
    expect(await prisma.order.count({ where: { tableId: tables.A.id } })).toBe(1);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.payIntent).toBe('CASH');
    expect(row.heldForPayment).toBe(false);
    expect(row.status).toBe('OPEN'); // never "paid" by ordering
    expect(await kotCount(a.id)).toBeGreaterThan(0);
    const st = (await guest.get(`/api/v1/public/menu/${tables.A.qr}/status`).expect(200)).body.order;
    expect(st.paid).toBe(false);
    expect(st.payIntent).toBe('CASH');
    expect(st.kitchen).toBe('NEW');
    tables.A.id = tables.A.id;
    (tables.A as { order?: string }).order = a.id;
  });

  it('an order waiting for online payment sends nothing to the kitchen, extra rounds included, until it is released once', async () => {
    const o = (await order('B', { payment: 'CASH' }).expect(201)).body; // then put it in the "waiting for payment" state
    await prisma.kot.deleteMany({ where: { orderId: o.id } });
    await prisma.order.update({ where: { id: o.id }, data: { payIntent: 'ONLINE', heldForPayment: true } });
    const st = (await guest.get(`/api/v1/public/menu/${tables.B.qr}/status`).expect(200)).body.order;
    expect(st.kitchen).toBe('WAITING_PAYMENT');
    expect(st.paid).toBe(false);
    await order('B', {}, 2).expect(201); // the guest adds a round while still unpaid
    expect(await kotCount(o.id)).toBe(0);
    expect((await guest.post(`/api/v1/orders/${o.id}/release${q}`)).status).toBe(401); // a guest cannot release their own order
    const first = await owner.post(`/api/v1/orders/${o.id}/release${q}`).expect(201);
    expect(first.body.released).toBe(true);
    const n = await kotCount(o.id);
    expect(n).toBeGreaterThan(0);
    const second = await owner.post(`/api/v1/orders/${o.id}/release${q}`).expect(201);
    expect(second.body.released).toBe(false); // the kitchen never gets it twice
    expect(await kotCount(o.id)).toBe(n);
    const items = await prisma.orderItem.count({ where: { orderId: o.id } });
    expect(items).toBeGreaterThanOrEqual(2); // both rounds are on the one order
    (tables.B as { order?: string }).order = o.id;
  });

  it('"I could not pay online, I will pay at the register" releases the order and records the intent', async () => {
    const o = (await order('C', { payment: 'CASH' }).expect(201)).body;
    await prisma.kot.deleteMany({ where: { orderId: o.id } });
    await prisma.order.update({ where: { id: o.id }, data: { payIntent: 'ONLINE', heldForPayment: true } });
    await guest.post(`/api/v1/public/menu/${tables.C.qr}/orders/${o.id}/pay-cash`).expect(201);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row.payIntent).toBe('CASH');
    expect(row.heldForPayment).toBe(false);
    expect(row.status).toBe('OPEN');
    expect(await kotCount(o.id)).toBeGreaterThan(0);
    expect((await guest.post(`/api/v1/public/menu/${tables.C.qr}/orders/${o.id}/pay-cash`)).status).toBe(409);
    (tables.C as { order?: string }).order = o.id;
  });

  it('a guest cannot start a payment for another table\'s order', async () => {
    const wrong = await guest.post(`/api/v1/public/menu/${tables.A.qr}/orders/${(tables.B as { order?: string }).order}/pay-online`).send({});
    expect(wrong.status).toBe(404);
  });

  // ---- buzzers ---------------------------------------------------------------------------------------

  it('the kitchen pages the table; the buzzer collects the call, acknowledges it, and a double press does not buzz twice', async () => {
    const bz = (await owner.post(`/api/v1/paging/buzzers${q}`).send({ name: `Buzz A ${tag}`, number: '7', tableId: tables.A.id }).expect(201)).body;
    expect((await owner.post(`/api/v1/paging/buzzers${q}`).send({ name: `Dup ${tag}`, tableId: tables.A.id })).status).toBe(409); // one buzzer per table
    const orderA = (tables.A as { order?: string }).order!;
    const first = (await owner.post(`/api/v1/paging/orders/${orderA}/call${q}`).send({}).expect(201)).body;
    expect(first.deviceOnline).toBe(false); // it has never polled: the kitchen is told
    expect(first.call.state).toBe('PENDING');
    const again = (await owner.post(`/api/v1/paging/orders/${orderA}/call${q}`).send({}).expect(201)).body;
    expect(again.duplicate).toBe(true);
    expect(again.call.id).toBe(first.call.id);
    const dev = request.agent(app.getHttpServer());
    const poll = (await dev.get(`/api/v1/public/buzzer/${bz.deviceToken}/poll`).expect(200)).body;
    expect(poll.call.id).toBe(first.call.id);
    const st = (await guest.get(`/api/v1/public/menu/${tables.A.qr}/status`).expect(200)).body.order;
    expect(st.paged).toBe(true);
    await dev.post(`/api/v1/public/buzzer/${bz.deviceToken}/ack`).send({ callId: first.call.id }).expect(201);
    expect((await dev.get(`/api/v1/public/buzzer/${bz.deviceToken}/poll`).expect(200)).body.call).toBeNull();
    const list = (await owner.get(`/api/v1/paging/buzzers${q}`).expect(200)).body.find((b: { id: string }) => b.id === bz.id);
    expect(list.online).toBe(true);
    expect(list.webhookSecret).toBeUndefined();
    expect((await dev.get('/api/v1/public/buzzer/not-a-token/poll')).status).toBe(404);
  });

  it('a table with no buzzer says so instead of pretending to page it', async () => {
    const r = await owner.post(`/api/v1/paging/orders/${(tables.B as { order?: string }).order}/call${q}`).send({});
    expect(r.status).toBe(404);
    expect(r.body.message).toMatch(/No buzzer/);
  });

  it('a webhook buzzer gets a signed call; an unreachable base station is recorded as FAILED, not hidden', async () => {
    const port = (hook.address() as { port: number }).port;
    const secret = 's3cret-' + tag;
    await owner.post(`/api/v1/paging/buzzers${q}`).send({ name: `Hook B ${tag}`, tableId: tables.B.id, driver: 'WEBHOOK', webhookUrl: `http://127.0.0.1:${port}/page`, webhookSecret: secret }).expect(201);
    const ok = (await owner.post(`/api/v1/paging/orders/${(tables.B as { order?: string }).order}/call${q}`).send({}).expect(201)).body;
    expect(ok.call.state).toBe('SENT');
    const h = hits[hits.length - 1];
    expect(h.sig).toBe(createHmac('sha256', secret).update(h.body).digest('hex'));
    expect(JSON.parse(h.body).event).toBe('page');
    const dead = (await owner.post(`/api/v1/paging/buzzers${q}`).send({ name: `Hook C ${tag}`, tableId: tables.C.id, driver: 'WEBHOOK', webhookUrl: 'http://127.0.0.1:9/nope' }).expect(201)).body;
    const fail = (await owner.post(`/api/v1/paging/orders/${(tables.C as { order?: string }).order}/call${q}`).send({}).expect(201)).body;
    expect(fail.call.state).toBe('FAILED');
    expect(fail.call.error).toBeTruthy();
    expect((await owner.post(`/api/v1/paging/buzzers${q}`).send({ name: `Bad ${tag}`, driver: 'WEBHOOK', webhookUrl: 'ftp://x' })).status).toBe(400);
    void dead;
  });

  // ---- customer display --------------------------------------------------------------------------------

  it('a customer screen reads its own state by token, only: idle, then the order, never anything else', async () => {
    const t = (await owner.post(`/api/v1/display/terminals${q}`).send({ name: `Counter ${tag}`, idleSeconds: 30 }).expect(201)).body;
    const view0 = (await guest.get(`/api/v1/public/display/${t.token}`).expect(200)).body;
    expect(view0.state.kind).toBe('idle');
    expect(view0.terminal.idleSeconds).toBe(30);
    expect(view0.ads.filter((a: { title: string | null }) => a.title?.includes(tag))).toEqual([]);
    const cart = { kind: 'cart', lines: [{ name: '1 kg Mango', quantity: 1, total: 180 }, { name: 'Papaya', quantity: 2, total: 90 }], subtotal: 270 };
    await cashier.put(`/api/v1/display/terminals/${t.id}/state${q}`).send(cart).expect(200);
    const view1 = (await guest.get(`/api/v1/public/display/${t.token}`).expect(200)).body;
    expect(view1.state).toEqual(cart);
    expect(Math.abs(view1.serverTime - view1.stateAt)).toBeLessThan(5000);
    expect(JSON.stringify(view1)).not.toMatch(/branchId|restaurantId|token/);
    expect((await cashier.put(`/api/v1/display/terminals/${t.id}/state${q}`).send({ kind: 'cart', lines: 'x' })).status).toBe(400);
    expect((await guest.get('/api/v1/public/display/not-a-token')).status).toBe(404);
    expect((await cashier.post(`/api/v1/display/terminals${q}`).send({ name: 'x' })).status).toBe(403); // setting up screens is for managers
    // a new token invalidates the old URL at once
    const rot = (await owner.post(`/api/v1/display/terminals/${t.id}/rotate-token${q}`).expect(201)).body;
    expect((await guest.get(`/api/v1/public/display/${t.token}`)).status).toBe(404);
    expect((await guest.get(`/api/v1/public/display/${rot.token}`)).status).toBe(200);
    await owner.patch(`/api/v1/display/terminals/${t.id}${q}`).send({ isActive: false }).expect(200);
    expect((await guest.get(`/api/v1/public/display/${rot.token}`)).status).toBe(404);
  });

  it('adverts: only real pictures and videos, schedule and per-screen targeting respected', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = (await owner.post(`/api/v1/display/media${q}`).attach('file', png, { filename: 'sale.png', contentType: 'image/png' }).expect(201)).body;
    expect(up.kind).toBe('IMAGE');
    expect((await owner.post(`/api/v1/display/media${q}`).attach('file', Buffer.from('<html>nope</html>'), { filename: 'x.mp4', contentType: 'video/mp4' })).status).toBe(400);
    expect((await owner.post(`/api/v1/display/media${q}`).attach('file', Buffer.from('MZ not an image'), { filename: 'x.exe', contentType: 'application/octet-stream' })).status).toBe(400);
    const t1 = (await owner.post(`/api/v1/display/terminals${q}`).send({ name: `Left ${tag}` }).expect(201)).body;
    const t2 = (await owner.post(`/api/v1/display/terminals${q}`).send({ name: `Right ${tag}` }).expect(201)).body;
    const all = (await owner.post(`/api/v1/display/ads${q}`).send({ kind: 'IMAGE', url: up.url, title: `Everyone ${tag}`, sortOrder: 2 }).expect(201)).body;
    const only1 = (await owner.post(`/api/v1/display/ads${q}`).send({ kind: 'IMAGE', url: up.url, title: `Left only ${tag}`, terminalId: t1.id, sortOrder: 1 }).expect(201)).body;
    const future = (await owner.post(`/api/v1/display/ads${q}`).send({ kind: 'IMAGE', url: up.url, title: `Later ${tag}`, startsOn: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body;
    const titles = async (tok: string) => ((await guest.get(`/api/v1/public/display/${tok}`).expect(200)).body.ads as { title: string }[]).map((a) => a.title).filter((t) => t?.includes(tag));
    expect(await titles(t1.token)).toEqual([`Left only ${tag}`, `Everyone ${tag}`]);
    expect(await titles(t2.token)).toEqual([`Everyone ${tag}`]);
    expect((await owner.post(`/api/v1/display/ads${q}`).send({ kind: 'IMAGE', url: 'https://evil.example/a.png' })).status).toBe(400);
    for (const a of [all, only1, future]) await owner.delete(`/api/v1/display/ads/${a.id}${q}`).expect(200);
  });
});
