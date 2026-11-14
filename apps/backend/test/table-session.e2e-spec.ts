/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// A static table QR must not be enough to order. Live table sessions, replay, cross-table use, lockout, expiry.
//   SESSION_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand table-session
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.SESSION_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);

run('Live table sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let chef: ReturnType<typeof request.agent>;
  let guest: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemId: string;
  const T: Record<string, { id: string; qr: string }> = {};

  const mkTable = async (n: string) => {
    const t = (await owner.post(`/api/v1/tables${q}`).send({ floorId, number: `${n}-${tag}`, capacity: 2 }).expect(201)).body;
    T[n] = { id: t.id, qr: (await owner.post(`/api/v1/tables/${t.id}/qr-token${q}`).expect(201)).body.qrToken };
  };
  const open = async (n: string) => (await cashier.post(`/api/v1/tables/${T[n].id}/session${q}`).send({}).expect(201)).body as { code: string; sessionId: string; expiresAt: string };
  const join = (n: string, code: string) => guest.post(`/api/v1/public/menu/${T[n].qr}/session`).send({ code });
  const order = (n: string, token?: string) => {
    const r = guest.post(`/api/v1/public/menu/${T[n].qr}/order`);
    if (token) r.set('x-table-session', token);
    return r.send({ guestName: 'Asha', items: [{ menuItemId: itemId, quantity: 1, modifierIds: [] }] });
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1); // so the test can act as different sources
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const mk = async (role: string, label: string) => {
      const email = `${label}-${tag}@demo.local`;
      await owner.post('/api/v1/users').send({ name: `${label} ${tag}`, email, password: 'Password123!', roleId: roles.find((r) => r.name === role)!.id, branchIds: [BRANCH] }).expect(201);
      const a = request.agent(app.getHttpServer());
      await a.post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(201);
      return a;
    };
    cashier = await mk('CASHIER', 'cashier');
    chef = await mk('CHEF', 'chef');
    guest = request.agent(app.getHttpServer());
    floorId = (await owner.post(`/api/v1/tables/floors${q}`).send({ name: `Sess ${tag}` }).expect(201)).body.id;
    for (const n of ['A', 'B']) await mkTable(n);
    const dishes = (await owner.get(`/api/v1/menu/items${q}`).expect(200)).body as { id: string; name: string }[];
    itemId = (dishes.find((d) => d.name === 'Coca-Cola') ?? dishes.find((d) => d.name.startsWith('PlainItem')) ?? dishes[0]).id;
    await owner.patch(`/api/v1/inventory/manufacturing/settings${q}`).send({ requireTableSession: true }).expect(200);
  });
  afterAll(async () => {
    await prisma.floor.deleteMany({ where: { id: floorId } });
    await app.close();
  });

  it('the printed QR alone cannot place an order, and the menu tells the page a code is needed', async () => {
    const m = (await guest.get(`/api/v1/public/menu/${T.A.qr}`).expect(200)).body;
    expect(m.session.required).toBe(true);
    const r = await order('A');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('TABLE_SESSION_REQUIRED');
    expect((await order('A', 'made-up-token')).body.code).toBe('TABLE_SESSION_REQUIRED');
    expect(await prisma.order.count({ where: { tableId: T.A.id } })).toBe(0);
  });

  it('with no session open, a guest cannot get in, and is told to ask staff', async () => {
    const r = await join('A', 'ABC234');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('TABLE_SESSION_EXPIRED');
  });

  it('staff open a session: the code is shown once, only its hash is stored, and guests with it can order', async () => {
    const s = await open('A');
    expect(s.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    const row = await prisma.tableSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(JSON.stringify(row)).not.toContain(s.code);
    expect(row.codeHash).toHaveLength(64);
    expect(JSON.stringify((await cashier.get(`/api/v1/tables/sessions${q}`).expect(200)).body)).not.toContain(s.code);
    const g = (await join('A', s.code.toLowerCase()).expect(201)).body; // case does not matter
    expect(g.token.length).toBeGreaterThan(30);
    const stored = await prisma.tableSessionGrant.findMany({ where: { sessionId: s.sessionId } });
    expect(stored.some((x) => x.tokenHash === g.token)).toBe(false); // the bearer itself is not stored
    await order('A', g.token).expect(201);
    const st = (await guest.get(`/api/v1/public/menu/${T.A.qr}/session`).set('x-table-session', g.token).expect(200)).body;
    expect(st).toEqual({ required: true, open: true, valid: true });
    (T.A as { tok?: string }).tok = g.token;
    (T.A as { code?: string }).code = s.code;
  });

  it('a grant for one table does not work on another table, and is not replayable elsewhere', async () => {
    await open('B');
    const r = await order('B', (T.A as { tok?: string }).tok);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('TABLE_SESSION_REQUIRED');
    expect(await prisma.order.count({ where: { tableId: T.B.id } })).toBe(0);
  });

  it('only staff with the table-session permission can open one', async () => {
    expect((await guest.post(`/api/v1/tables/${T.B.id}/session${q}`).send({})).status).toBe(401);
    expect((await chef.post(`/api/v1/tables/${T.B.id}/session${q}`).send({})).status).toBe(403);
  });

  it('paying or switching to cash needs the live session grant, not just the static table QR', async () => {
    await mkTable('P');
    const s = await open('P');
    const g = (await join('P', s.code).expect(201)).body;
    const o = (await order('P', g.token).expect(201)).body;
    await prisma.order.update({ where: { id: o.id }, data: { payIntent: 'ONLINE', heldForPayment: true } });
    const url = (what: string) => `/api/v1/public/menu/${T.P.qr}/orders/${o.id}/${what}`;

    // The QR token and the order id are all a bystander can learn (status shows the id); that must not be enough.
    for (const what of ['pay-cash', 'pay-online']) {
      const none = await guest.post(url(what)).send({});
      expect(none.status).toBe(403);
      expect(JSON.stringify(none.body)).toContain('TABLE_SESSION_REQUIRED');
      expect((await guest.post(url(what)).set('x-table-session', 'not-a-real-grant-token-0000000000000000').send({})).status).toBe(403);
    }
    const untouched = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(untouched.payIntent).toBe('ONLINE');
    expect(untouched.heldForPayment).toBe(true); // nothing was released to the kitchen

    // A grant for a different table is no good either.
    await mkTable('Q');
    const other = (await join('Q', (await open('Q')).code).expect(201)).body;
    expect((await guest.post(url('pay-cash')).set('x-table-session', other.token).send({})).status).toBe(403);

    // The guest who holds this table's grant still can.
    await guest.post(url('pay-cash')).set('x-table-session', g.token).send({}).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).payIntent).toBe('CASH');
  });

  it('a source that keeps guessing blocks only itself; distributed guessing still locks the session', async () => {
    const s = await open('B');
    const from = (ip: string, code: string) => guest.post(`/api/v1/public/menu/${T.B.qr}/session`).set('X-Forwarded-For', ip).send({ code });
    for (let i = 0; i < 7; i++) expect((await from('10.0.0.1', 'ZZZZZZ')).body.code).toBe('TABLE_SESSION_BAD_CODE');
    expect((await from('10.0.0.1', 'ZZZZZZ')).status).toBe(403); // eighth wrong code: this source is now blocked
    const blocked = await from('10.0.0.1', s.code);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TABLE_SESSION_LOCKED');

    // Someone else at the table is NOT locked out by that source (the old behaviour locked the whole session).
    expect((await from('10.0.0.2', s.code)).status).toBe(201);

    // Guessing spread over many sources still trips the session-wide limit, with an audit row and no code in it.
    await prisma.tableSession.update({ where: { id: s.sessionId }, data: { failedTries: 59 } });
    expect((await from('10.0.0.3', 'ZZZZZZ')).status).toBe(403);
    const locked = await from('10.0.0.4', s.code);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('TABLE_SESSION_LOCKED');
    const reopened = await open('B'); // staff reset clears the lock with a brand new code
    expect((await from('10.0.0.5', reopened.code)).status).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'table_session.locked', entityId: T.B.id } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain('ZZZZZZ');
  });

  it('resetting the session kills the old code and every phone that held it', async () => {
    const before = (T.A as { tok?: string }).tok!;
    const old = (T.A as { code?: string }).code!;
    const fresh = await open('A');
    const r = await order('A', before);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('TABLE_SESSION_EXPIRED');
    expect((await join('A', old)).body.code).toBe('TABLE_SESSION_BAD_CODE');
    const tok = (await join('A', fresh.code).expect(201)).body.token;
    await order('A', tok).expect(201);
    (T.A as { tok?: string }).tok = tok;
  });

  it('closing ends it; setting the table free ends it; expiry ends it', async () => {
    const tok = (T.A as { tok?: string }).tok!;
    await cashier.delete(`/api/v1/tables/${T.A.id}/session${q}`).expect(200);
    expect((await order('A', tok)).body.code).toBe('TABLE_SESSION_EXPIRED');

    const b = await open('B');
    const tb = (await join('B', b.code).expect(201)).body.token;
    await prisma.order.updateMany({ where: { tableId: T.B.id }, data: { status: 'CANCELLED' } });
    await owner.patch(`/api/v1/tables/${T.B.id}/status${q}`).send({ status: 'AVAILABLE' }).expect(200);
    expect((await order('B', tb)).body.code).toBe('TABLE_SESSION_EXPIRED');

    const c = await open('A');
    const tc = (await join('A', c.code).expect(201)).body.token;
    await prisma.tableSession.update({ where: { id: c.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await order('A', tc)).body.code).toBe('TABLE_SESSION_EXPIRED');
    expect((await guest.get(`/api/v1/public/menu/${T.A.qr}/session`).set('x-table-session', tc).expect(200)).body.valid).toBe(false);
  });

  it('call-waiter from a photographed QR is also refused; the restaurant can switch the requirement off', async () => {
    expect((await guest.post(`/api/v1/public/menu/${T.A.qr}/request`).send({ type: 'WAITER' })).status).toBe(403);
    await owner.patch(`/api/v1/inventory/manufacturing/settings${q}`).send({ requireTableSession: false }).expect(200);
    await order('A').expect(201); // older behaviour, only if the owner chooses it
    await owner.patch(`/api/v1/inventory/manufacturing/settings${q}`).send({ requireTableSession: true }).expect(200);
  });
});
