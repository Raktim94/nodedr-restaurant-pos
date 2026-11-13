/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Stock journal, daily production and food waste against a REAL migrated + seeded Postgres.
//   JOURNAL_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand stock-journal
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.JOURNAL_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Stock journal, production and waste (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let chef: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  const id: Record<string, string> = {};

  const item = async (name: string, unit: string, extra: object = {}) =>
    (await owner.post(`/api/v1/inventory/ingredients${q}`).send({ name: `${name}-${tag}`, unit, ...extra }).expect(201)).body.id as string;
  const stock = async (ingredientId: string) =>
    (await owner.get(`/api/v1/inventory/ingredients/${ingredientId}${q}`).expect(200)).body.currentStock as string;
  const journal = async (qs = '') =>
    (await owner.get(`/api/v1/inventory/journal${q}${qs}`).expect(200)).body.items as { type: string; quantity: string; ingredient: { id: string }; productionEntryId: string | null }[];
  const receive = (ingredientId: string, quantity: string | number, unit: string) =>
    owner.post(`/api/v1/inventory/journal/receipts${q}`).send({ ingredientId, quantity, unit, reference: 'INV-1' });
  const batch = (over: object = {}) => ({
    shift: 'Morning',
    location: 'Main kitchen',
    inputs: [
      { ingredientId: id.rice, quantity: '6', unit: 'KG' },
      { ingredientId: id.dal, quantity: '2000', unit: 'G' },
    ],
    outputs: [{ ingredientId: id.idli, quantity: '120', unit: 'PIECE' }],
    post: true,
    ...over,
  });
  const produce = (body: object) => owner.post(`/api/v1/inventory/production${q}`).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const mk = async (roleName: string) => {
      const email = `${roleName.toLowerCase()}-${tag}@demo.local`;
      await owner.post('/api/v1/users').send({
        name: `${roleName} ${tag}`, email, password: 'Password123!',
        roleId: roles.find((r) => r.name === roleName)!.id, branchIds: [BRANCH],
      }).expect(201);
      const a = request.agent(app.getHttpServer());
      await a.post('/api/v1/auth/login').send({ email, password: 'Password123!' }).expect(201);
      return a;
    };
    chef = await mk('CHEF');
    cashier = await mk('CASHIER');

    id.rice = await item('Rice', 'KG');
    id.dal = await item('Urad dal', 'KG');
    id.oil = await item('Oil', 'L');
    id.idli = await item('Idli', 'PIECE', { kind: 'PREPARED', wasteApprovalQty: 50 });
    id.sambar = await item('Sambar', 'L', { kind: 'PREPARED' });
    id.bag = await item('Flour bag', 'PACK', { conversions: [{ unit: 'KG', per: 25 }] });
  });
  afterAll(async () => {
    await app.close();
  });

  it('receives stock in other units and keeps exact decimals', async () => {
    await receive(id.rice, 25, 'KG').expect(201);
    await receive(id.dal, '10', 'KG').expect(201);
    await receive(id.dal, '500', 'G').expect(201); // 0.5 kg
    expect(await stock(id.rice)).toBe('25');
    expect(await stock(id.dal)).toBe('10.5');
    // 0.1 kg + 0.2 kg is exactly 0.3 kg, not 0.30000000000000004
    await receive(id.oil, '100', 'ML').expect(201);
    await receive(id.oil, '200', 'ML').expect(201);
    expect(await stock(id.oil)).toBe('0.3');
    // a 25 kg bag, bought as 2 bags... stocked as PACK, received in KG through the declared conversion
    await receive(id.bag, '50', 'KG').expect(201);
    expect(await stock(id.bag)).toBe('2');
  });

  it('refuses units that cannot be converted and non-positive quantities', async () => {
    const bad = await receive(id.rice, 1, 'PIECE');
    expect(bad.status).toBe(400);
    expect((await receive(id.rice, 0, 'KG')).status).toBe(400);
    expect((await receive(id.rice, '0.0004', 'KG')).status).toBe(400); // 4 decimals: refused, not rounded
  });

  it('only finished products can be produced, and the review shows a shortfall before posting', async () => {
    const asOutput = await produce(batch({ outputs: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }], inputs: [{ ingredientId: id.dal, quantity: '1', unit: 'KG' }] }));
    expect(asOutput.status).toBe(400);
    const prev = await owner.post(`/api/v1/inventory/production/preview${q}`).send({
      inputs: [{ ingredientId: id.rice, quantity: '30', unit: 'KG' }],
      outputs: [{ ingredientId: id.idli, quantity: '10', unit: 'PIECE' }],
    }).expect(201);
    expect(prev.body.canPost).toBe(false);
    expect(prev.body.lines[0].short).toBe('5');
    expect(await stock(id.rice)).toBe('25'); // a preview writes nothing
  });

  it('posts a batch of actual quantities: ingredients out, finished product in, one linked ledger, no cost', async () => {
    const res = await produce(batch()).expect(201);
    id.entry = res.body.id;
    expect(res.body.status).toBe('POSTED');
    expect(res.body.entryNo).toMatch(/^PR-\d{8}-\d{3}$/);
    // a quantity-only batch carries no cost at all: not costed, no figures
    expect(res.body.costed).toBe(false);
    expect([res.body.totalCost, res.body.unitCost, res.body.ingredientCost]).toEqual([null, null, null]);
    expect(await stock(id.rice)).toBe('19');
    expect(await stock(id.dal)).toBe('8.5');
    expect(await stock(id.idli)).toBe('120');
    const linked = await journal(`&productionEntryId=${id.entry}`);
    expect(linked.map((m) => m.type).sort()).toEqual(['PRODUCTION', 'PRODUCTION_USE', 'PRODUCTION_USE']);
    const by = Object.fromEntries(linked.map((m) => [m.ingredient.id, m.quantity]));
    expect(by[id.rice]).toBe('-6');
    expect(by[id.dal]).toBe('-2');
    expect(by[id.idli]).toBe('120');
  });

  it('is atomic: a shortfall on the second ingredient leaves the first untouched', async () => {
    const res = await produce(batch({ inputs: [
      { ingredientId: id.rice, quantity: '1', unit: 'KG' },
      { ingredientId: id.dal, quantity: '99', unit: 'KG' },
    ] }));
    expect(res.status).toBe(400);
    expect(await stock(id.rice)).toBe('19');
    expect(await stock(id.idli)).toBe('120');
  });

  it('a retried upload with the same key posts once', async () => {
    const key = `dev1-${randomUUID()}`;
    const a = await produce(batch({ idempotencyKey: key, deviceId: 'phone-1', inputs: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }], outputs: [{ ingredientId: id.idli, quantity: '10', unit: 'PIECE' }] })).expect(201);
    const b = await produce(batch({ idempotencyKey: key, deviceId: 'phone-1', inputs: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }], outputs: [{ ingredientId: id.idli, quantity: '10', unit: 'PIECE' }] })).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await stock(id.rice)).toBe('18');
    expect(await stock(id.idli)).toBe('130');
    const dev = (await journal(`&productionEntryId=${a.body.id}`)).length;
    expect(dev).toBe(2);
  });

  it('drafts do not touch stock and a posted entry cannot be edited or posted twice', async () => {
    const d = await produce(batch({ post: false })).expect(201);
    expect(d.body.status).toBe('DRAFT');
    expect(await stock(id.rice)).toBe('18');
    await owner.post(`/api/v1/inventory/production/${d.body.id}/post${q}`).expect(201);
    expect(await stock(id.rice)).toBe('12');
    expect((await owner.post(`/api/v1/inventory/production/${d.body.id}/post${q}`)).status).toBe(409);
    expect((await owner.patch(`/api/v1/inventory/production/${d.body.id}${q}`).send(batch({ post: undefined }))).status).toBe(400);
    id.second = d.body.id;
  });

  it('kitchen staff can record but not reverse; cashiers cannot see production at all', async () => {
    expect((await chef.get(`/api/v1/inventory/production${q}`)).status).toBe(200);
    expect((await chef.post(`/api/v1/inventory/production/${id.second}/void${q}`).send({ reason: 'oops, wrong' })).status).toBe(403);
    expect((await cashier.get(`/api/v1/inventory/production${q}`)).status).toBe(403);
    expect((await chef.get(`/api/v1/inventory/journal${q}`)).status).toBe(403); // the full ledger is for managers
  });

  it('a void needs a reason, reverses by appending, and cannot be repeated', async () => {
    expect((await owner.post(`/api/v1/inventory/production/${id.second}/void${q}`).send({})).status).toBe(400);
    const v = await owner.post(`/api/v1/inventory/production/${id.second}/void${q}`).send({ reason: 'Entered twice by mistake' }).expect(201);
    expect(v.body.status).toBe('VOIDED');
    expect(await stock(id.rice)).toBe('18');
    expect(await stock(id.idli)).toBe('130');
    const linked = await journal(`&productionEntryId=${id.second}`);
    expect(linked.filter((m) => m.type === 'REVERSAL')).toHaveLength(3);
    expect(linked.filter((m) => m.type === 'PRODUCTION_USE')).toHaveLength(2); // originals still there
    expect((await owner.post(`/api/v1/inventory/production/${id.second}/void${q}`).send({ reason: 'again' })).status).toBe(400);
  });

  it('a correction reverses the old entry and posts the right one, linked', async () => {
    const c = await owner.post(`/api/v1/inventory/production/${id.entry}/correct${q}`).send({
      reason: 'Counted 118 idlis, not 120',
      inputs: [{ ingredientId: id.rice, quantity: '6', unit: 'KG' }, { ingredientId: id.dal, quantity: '2', unit: 'KG' }],
      outputs: [{ ingredientId: id.idli, quantity: '118', unit: 'PIECE' }],
    }).expect(201);
    expect(c.body.correctsEntry.id).toBe(id.entry);
    expect(await stock(id.idli)).toBe('128'); // 130 - 120 + 118
    expect(await stock(id.rice)).toBe('18');
    const old = (await owner.get(`/api/v1/inventory/production/${id.entry}${q}`).expect(200)).body;
    expect(old.status).toBe('VOIDED');
    expect(old.correctedBy[0].id).toBe(c.body.id);
    id.entry = c.body.id;
  });

  it('waste moves stock exactly once; a loss already inside production does not move it again', async () => {
    const before = await stock(id.idli);
    const w = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.idli, quantity: '8', unit: 'PIECE', reason: 'OVER_PRODUCTION', shift: 'Morning' }).expect(201);
    expect(w.body.kind).toBe('FINISHED');
    expect(Number(await stock(id.idli))).toBe(Number(before) - 8);
    const wasted = await journal(`&wasteEntryId=${w.body.id}`);
    expect(wasted.map((m) => m.type)).toEqual(['WASTE']);

    const mid = await stock(id.idli);
    const inc = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.idli, quantity: '2', unit: 'PIECE', reason: 'PREP_ERROR', includedInProduction: true, productionEntryId: id.entry }).expect(201);
    expect(inc.body.includedInProduction).toBe(true);
    expect(await stock(id.idli)).toBe(mid); // not deducted a second time
    expect((await journal(`&wasteEntryId=${inc.body.id}`)).length).toBe(0);

    const rep = (await owner.get(`/api/v1/inventory/waste/report${q}`).expect(200)).body;
    expect(rep.entryCount).toBeGreaterThanOrEqual(1);
    expect(rep.alreadyInProduction).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rep)).not.toMatch(/cost|price|amount/i);
    id.waste = w.body.id;
  });

  it('waste validation: Other needs a note; an in-production loss needs a posted entry', async () => {
    const other = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.rice, quantity: '1', unit: 'KG', reason: 'OTHER' });
    expect(other.status).toBe(400);
    const bad = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.idli, quantity: '1', unit: 'PIECE', reason: 'PREP_ERROR', includedInProduction: true, productionEntryId: id.second });
    expect(bad.status).toBe(400); // voided entry
    const over = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.rice, quantity: '500', unit: 'KG', reason: 'SPOILED' });
    expect(over.status).toBe(400);
  });

  it('a large waste entry by a cook waits for a manager, and rejecting it puts stock back', async () => {
    const before = await stock(id.idli);
    const w = await chef.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.idli, quantity: '60', unit: 'PIECE', reason: 'SPOILED' }).expect(201);
    expect(w.body.status).toBe('PENDING_APPROVAL');
    expect(Number(await stock(id.idli))).toBe(Number(before) - 60);
    expect((await chef.post(`/api/v1/inventory/waste/entries/${w.body.id}/approve${q}`).send({})).status).toBe(403);
    await owner.post(`/api/v1/inventory/waste/entries/${w.body.id}/reject${q}`).send({ note: 'Not believable' }).expect(201);
    expect(await stock(id.idli)).toBe(before);
    expect((await owner.post(`/api/v1/inventory/waste/entries/${w.body.id}/reverse${q}`).send({ reason: 'again' })).status).toBe(400);
  });

  it('reversing waste restores the stock once', async () => {
    const before = await stock(id.idli);
    await owner.post(`/api/v1/inventory/waste/entries/${id.waste}/reverse${q}`).send({ reason: 'Logged on the wrong day' }).expect(201);
    expect(Number(await stock(id.idli))).toBe(Number(before) + 8);
    expect((await owner.post(`/api/v1/inventory/waste/entries/${id.waste}/reverse${q}`).send({ reason: 'twice' })).status).toBe(400);
  });

  it('a batch with sold or wasted finished stock cannot be reversed', async () => {
    const e = await produce(batch({ inputs: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }], outputs: [{ ingredientId: id.sambar, quantity: '8', unit: 'L' }] })).expect(201);
    await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.sambar, quantity: '1', unit: 'L', reason: 'SPOILED' }).expect(201);
    const v = await owner.post(`/api/v1/inventory/production/${e.body.id}/void${q}`).send({ reason: 'wrong batch' });
    expect(v.status).toBe(400);
    expect(JSON.stringify(v.body)).toMatch(/already been sold or wasted/);
  });

  it('a phone replaying the same waste event twice records it once', async () => {
    const key = `phone-${randomUUID()}`;
    const body = { ingredientId: id.sambar, quantity: '1', unit: 'L', reason: 'SPOILED', idempotencyKey: key, deviceId: 'phone-9' };
    const before = await stock(id.sambar);
    const a = await owner.post(`/api/v1/inventory/waste/entries${q}`).send(body).expect(201);
    const b = await owner.post(`/api/v1/inventory/waste/entries${q}`).send(body).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(Number(await stock(id.sambar))).toBe(Number(before) - 1);
    const m = await journal(`&wasteEntryId=${a.body.id}`);
    expect(m).toHaveLength(1);
  });

  it('a stock take books only the differences, keeps who counted, and is safe to resend', async () => {
    const sheet = {
      area: 'Dry store',
      lines: [
        { ingredientId: id.rice, counted: '11.5', unit: 'KG' },   // system had 11 -> +0.5
        { ingredientId: id.dal, counted: '6000', unit: 'G' },     // system 8.5 -> -2.5
        { ingredientId: id.oil, counted: '0.3', unit: 'L' },      // same as system -> no movement
      ],
      idempotencyKey: `count-${randomUUID()}`,
    };
    const rice0 = Number(await stock(id.rice));
    const dal0 = Number(await stock(id.dal));
    const first = (await owner.post(`/api/v1/inventory/journal/stock-takes${q}`).send(sheet).expect(201)).body;
    const diffs = Object.fromEntries(first.lines.map((l: { name: string; difference: string }) => [l.name.split('-')[0], l.difference]));
    expect(Number(diffs.Rice)).toBeCloseTo(11.5 - rice0, 6);
    expect(Number(diffs['Urad dal'])).toBeCloseTo(6 - dal0, 6);
    expect(Number(diffs.Oil)).toBe(0);
    expect(Number(await stock(id.rice))).toBeCloseTo(11.5, 6);
    expect(Number(await stock(id.dal))).toBeCloseTo(6, 6);
    await owner.post(`/api/v1/inventory/journal/stock-takes${q}`).send(sheet).expect(201); // resend
    expect(Number(await stock(id.dal))).toBeCloseTo(6, 6);
    const adj = (await journal('&type=ADJUSTMENT')).filter((m) => m.ingredient.id === id.oil);
    expect(adj.length).toBe(0);
    // counting more than the system never goes negative; a negative count is refused
    expect((await owner.post(`/api/v1/inventory/journal/stock-takes${q}`).send({ lines: [{ ingredientId: id.rice, counted: '-1', unit: 'KG' }] })).status).toBe(400);
    expect((await chef.post(`/api/v1/inventory/journal/stock-takes${q}`).send(sheet)).status).toBe(403);
  });

  it('keeps stock in places: count a place, move stock between places, never more than is there', async () => {
    const fridge = (await owner.post(`/api/v1/inventory/locations${q}`).send({ name: `Fridge ${tag}` }).expect(201)).body;
    const dry = (await owner.post(`/api/v1/inventory/locations${q}`).send({ name: `Dry ${tag}` }).expect(201)).body;
    expect((await owner.post(`/api/v1/inventory/locations${q}`).send({ name: `Dry ${tag}` })).status).toBe(409);
    const flour = await item('Atta', 'KG');
    await receive(flour, 20, 'KG').expect(201);
    // nothing is placed yet: all 20 are unassigned
    const m0 = (await owner.get(`/api/v1/inventory/locations/matrix${q}`).expect(200)).body.items.find((i: { id: string }) => i.id === flour);
    expect(Number(m0.unassigned)).toBe(20);
    // counting 12 kg in the Dry store keeps the total (the system said 20 in total, 0 recorded there -> +12 would raise it)
    // so first move 20 from unassigned into Dry, then count Dry as 18 (2 kg missing): total 18
    await owner.post(`/api/v1/inventory/locations/transfers${q}`).send({ ingredientId: flour, toLocationId: dry.id, quantity: '20', unit: 'KG' }).expect(201);
    const take = (await owner.post(`/api/v1/inventory/journal/stock-takes${q}`).send({ area: `Dry ${tag}`, lines: [{ ingredientId: flour, counted: '18', unit: 'KG' }] }).expect(201)).body;
    expect(Number(take.lines[0].expected)).toBe(20);
    expect(Number(take.lines[0].difference)).toBe(-2);
    expect(Number(await stock(flour))).toBe(18);
    // move 5 kg Dry -> Fridge; asking for more than Dry holds is refused
    const key = `loc-${randomUUID()}`;
    const t1 = (await owner.post(`/api/v1/inventory/locations/transfers${q}`).send({ ingredientId: flour, fromLocationId: dry.id, toLocationId: fridge.id, quantity: '5', unit: 'KG', idempotencyKey: key }).expect(201)).body;
    const t2 = (await owner.post(`/api/v1/inventory/locations/transfers${q}`).send({ ingredientId: flour, fromLocationId: dry.id, toLocationId: fridge.id, quantity: '5', unit: 'KG', idempotencyKey: key }).expect(201)).body;
    expect(t2.id).toBe(t1.id); // resent once, moved once
    expect((await owner.post(`/api/v1/inventory/locations/transfers${q}`).send({ ingredientId: flour, fromLocationId: dry.id, toLocationId: fridge.id, quantity: '50', unit: 'KG' })).status).toBe(400);
    expect((await owner.post(`/api/v1/inventory/locations/transfers${q}`).send({ ingredientId: flour, fromLocationId: dry.id, toLocationId: dry.id, quantity: '1', unit: 'KG' })).status).toBe(400);
    const m = (await owner.get(`/api/v1/inventory/locations/matrix${q}`).expect(200)).body.items.find((i: { id: string }) => i.id === flour);
    expect(Number(m.levels[dry.id])).toBe(13);
    expect(Number(m.levels[fridge.id])).toBe(5);
    expect(Number(m.total)).toBe(18); // transfers never change the total
    expect(Number(m.unassigned)).toBe(0);
    // a place with stock cannot be switched off
    expect((await owner.patch(`/api/v1/inventory/locations/${fridge.id}${q}`).send({ isActive: false })).status).toBe(409);
    expect((await chef.post(`/api/v1/inventory/locations/transfers${q}`).send({ ingredientId: flour, toLocationId: fridge.id, quantity: '1', unit: 'KG' })).status).toBe(403);
  });

  it('shows what expires soon and a shopping list up to the par level', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const fresh = await item('Paneer', 'KG', { reorderLevel: 5, parLevel: 20 });
    await owner.post(`/api/v1/inventory/journal/receipts${q}`).send({ ingredientId: fresh, quantity: '3', unit: 'KG', expiryDate: soon }).expect(201);
    const exp = (await owner.get(`/api/v1/inventory/journal/expiring${q}&days=7`).expect(200)).body as { ingredientId: string; daysLeft: number }[];
    const row = exp.find((e) => e.ingredientId === fresh)!;
    expect(row.daysLeft).toBeLessThanOrEqual(2);
    const list = (await owner.get(`/api/v1/inventory/journal/reorder${q}`).expect(200)).body as { id: string; toBuy: string; par: string }[];
    const need = list.find((r) => r.id === fresh)!;
    expect(Number(need.par)).toBe(20);
    expect(Number(need.toBuy)).toBe(17); // 20 - 3 in stock
    const csv = await owner.get(`/api/v1/inventory/journal/reorder.csv${q}`).expect(200);
    expect(csv.text).toContain('Paneer');
  });

  it('an optional waste photo is stored with the entry; a non-upload path is refused', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await owner.post(`/api/v1/inventory/waste/photo${q}`).attach('file', png, { filename: 'bin.png', contentType: 'image/png' }).expect(201);
    expect(up.body.url).toMatch(/^\/api\/uploads\//);
    const w = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.sambar, quantity: '1', unit: 'L', reason: 'SPOILED', photoUrl: up.body.url }).expect(201);
    expect(w.body.photoUrl).toBe(up.body.url);
    const bad = await owner.post(`/api/v1/inventory/waste/entries${q}`).send({ ingredientId: id.sambar, quantity: '1', unit: 'L', reason: 'SPOILED', photoUrl: 'https://evil.example/x.png' });
    expect(bad.status).toBe(400);
  });

  it('reports and exports: daily production, and the journal as CSV', async () => {
    const rep = (await owner.get(`/api/v1/inventory/production/report${q}&productId=${id.idli}`).expect(200)).body;
    const idliRow = rep.produced.find((p: { ingredientId: string }) => p.ingredientId === id.idli);
    expect(Number(idliRow.quantity)).toBe(128); // 118 (corrected) + 10 (second batch); voided ones excluded
    expect(rep.note).toMatch(/No cost/);
    const csv = await owner.get(`/api/v1/inventory/production/export.csv${q}`).expect(200);
    expect(csv.text).toContain('Entry,Produced at,Status');
    expect(csv.text).toContain(`Idli-${tag}`);
    const jcsv = await owner.get(`/api/v1/inventory/journal/export.csv${q}`).expect(200);
    expect(jcsv.text).toContain('PRODUCTION_USE');
  });
});
