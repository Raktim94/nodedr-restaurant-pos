/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Integration API end-to-end against a REAL, migrated + seeded Postgres.
//   INTEGRATIONS_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand integrations
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.INTEGRATIONS_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const API = '/api/v1/integrations';

run('Integration API (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  const keys: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const mint = async (name: string, scopes: string[], branchId?: string) => {
    const res = await owner
      .post('/api/v1/integration-api-keys')
      .send({ name, scopes, branchId })
      .expect(201);
    keys[name] = res.body.token;
    return res.body as { id: string; token: string };
  };
  const as = (name: string) => ({ Authorization: `Bearer ${keys[name]}` });
  const order = (over: Record<string, unknown> = {}) => ({
    type: 'DELIVERY',
    customerName: 'Jane Doe',
    customerPhone: '+91 98765 43210',
    customerEmail: 'jane@example.com',
    delivery: { address: '12 MG Road, Flat 4B', pincode: '700001' },
    items: [{ menuItemId: 'demo-item-cola', quantity: 2 }],
    ...over,
  });
  const place = (name: string, over = {}, idem?: string) =>
    http()
      .post(`${API}/locations/${BRANCH}/orders`)
      .set(as(name))
      .set(idem ? { 'Idempotency-Key': idem } : {})
      .send(order(over));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    await mint('full', [
      'menu:read',
      'orders:write',
      'orders:read',
      'orders:read_customer',
    ]);
    await mint('basic', ['orders:write', 'orders:read']);
    await mint('other', [
      'orders:write',
      'orders:read',
      'orders:read_customer',
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists phone and address, and returns them with the personal-data scope', async () => {
    const placed = await place('full').expect(201);
    expect(placed.body.customer).toBeUndefined();
    const got = await http()
      .get(
        `${API}/locations/${BRANCH}/orders/${placed.body.id}?include=customer`,
      )
      .set(as('full'))
      .expect(200);
    expect(got.body.customer).toEqual({
      name: 'Jane Doe',
      phone: '+91 98765 43210',
      email: 'jane@example.com',
    });
    expect(got.body.delivery).toMatchObject({
      address: '12 MG Road, Flat 4B',
      pincode: '700001',
      phone: '+91 98765 43210',
    });
    expect(got.body.fulfillment.deliveryStatus).toBe('UNASSIGNED');
  });

  it('keeps personal data out of the default read and the menu', async () => {
    const placed = await place('full').expect(201);
    const plain = await http()
      .get(`${API}/locations/${BRANCH}/orders/${placed.body.id}`)
      .set(as('full'))
      .expect(200);
    const menu = await http()
      .get(`${API}/locations/${BRANCH}/menu`)
      .set(as('full'))
      .expect(200);
    for (const body of [plain.body, menu.body]) {
      const json = JSON.stringify(body);
      expect(json).not.toContain('98765');
      expect(json).not.toContain('MG Road');
    }
  });

  it('denies: no scope, other key, bad/absent key, revoked key', async () => {
    const placed = await place('full').expect(201);
    const url = `${API}/locations/${BRANCH}/orders/${placed.body.id}`;
    await http().get(`${url}?include=customer`).set(as('basic')).expect(403);
    await http().get(url).set(as('other')).expect(404);
    await http().get(url).expect(401);
    await http()
      .get(url)
      .set({ Authorization: 'Bearer ordr_ext_nope' })
      .expect(401);
    const k = await mint('temp', ['orders:read']);
    await owner.delete(`/api/v1/integration-api-keys/${k.id}`).expect(200);
    await http().get(url).set(as('temp')).expect(401);
  });

  it('denies a key locked to another location', async () => {
    const branches = await owner.get('/api/v1/branches');
    const other = (branches.body as { id: string }[]).find(
      (b) => b.id !== BRANCH,
    );
    if (!other) return; // seed has a single branch
    await mint('wrongloc', ['orders:read'], other.id);
    await http()
      .get(`${API}/locations/${BRANCH}/menu`)
      .set(as('wrongloc'))
      .expect(403);
  });

  it('prices on the server and adds nothing the caller sends', async () => {
    const res = await place('full', {
      totalAmount: 1,
      items: [{ menuItemId: 'demo-item-cola', quantity: 2, price: 1 }],
    }).expect(201);
    expect(res.body.totals.subtotal).toBeGreaterThan(1);
    expect(res.body.totals.subtotal).toBe(res.body.items[0].unitPrice * 2);
  });

  it('is idempotent, including under parallel retries, and refuses a changed body', async () => {
    const key = randomUUID();
    const rs = await Promise.all(
      [1, 2, 3, 4].map(() => place('full', {}, key)),
    );
    rs.forEach((r) => expect(r.status).toBe(201));
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    await place(
      'full',
      { items: [{ menuItemId: 'demo-item-cola', quantity: 5 }] },
      key,
    ).expect(422);
  });

  it('validates input and rejects oversized bodies', async () => {
    await place('full', { delivery: undefined }).expect(400);
    await place('full', { customerPhone: 'abc' }).expect(400);
    await place('full', {}, 'short').expect(400);
    await place('full', { notes: 'x'.repeat(200_000) }).expect(413);
  });

  it('rotation keeps order access and kills the old secret', async () => {
    const k = await mint('rot', [
      'orders:write',
      'orders:read',
      'orders:read_customer',
    ]);
    const placed = await place('rot').expect(201);
    const rotated = await owner
      .post(`/api/v1/integration-api-keys/${k.id}/rotate`)
      .expect(201);
    const url = `${API}/locations/${BRANCH}/orders/${placed.body.id}?include=customer`;
    await http().get(url).set(as('rot')).expect(401);
    await http()
      .get(url)
      .set({ Authorization: `Bearer ${rotated.body.token}` })
      .expect(200);
  });
});
