/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Stock journal entries (transfer, waste, correction) against a REAL migrated + seeded Postgres.
//   JOURNAL_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand stock-journal-entries
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
const E = `/api/v1/inventory/journal/entries`;

run('Stock journal entries: transfer, waste, correction (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;
  let chef: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  const id: Record<string, string> = {};

  const item = async (name: string, unit: string, extra: object = {}) =>
    (
      await owner
        .post(`/api/v1/inventory/ingredients${q}`)
        .send({ name: `${name}-${tag}`, unit, ...extra })
        .expect(201)
    ).body.id as string;
  const place = async (name: string) =>
    (
      await owner
        .post(`/api/v1/inventory/locations${q}`)
        .send({ name: `${name}-${tag}` })
        .expect(201)
    ).body.id as string;
  const stock = async (ingredientId: string) =>
    (
      await owner
        .get(`/api/v1/inventory/ingredients/${ingredientId}${q}`)
        .expect(200)
    ).body.currentStock as string;
  const level = async (ingredientId: string, locationId: string) => {
    const m = (
      await owner.get(`/api/v1/inventory/locations/matrix${q}`).expect(200)
    ).body;
    const row = (
      m.items as {
        id: string;
        levels: Record<string, string>;
      }[]
    ).find((r) => r.id === ingredientId);
    return row?.levels?.[locationId] ?? '0';
  };

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
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const mk = async (roleName: string) => {
      const email = `${roleName.toLowerCase()}-sje-${tag}@demo.local`;
      await owner
        .post('/api/v1/users')
        .send({
          name: `${roleName} ${tag}`,
          email,
          password: 'Password123!',
          roleId: roles.find((r) => r.name === roleName)!.id,
          branchIds: [BRANCH],
        })
        .expect(201);
      const a = request.agent(app.getHttpServer());
      await a
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(201);
      return a;
    };
    chef = await mk('CHEF');
    cashier = await mk('CASHIER');

    id.rice = await item('Rice', 'KG');
    id.milk = await item('Milk', 'L');
    id.store = await place('Dry store');
    id.kitchen = await place('Kitchen');
    await owner
      .post(`/api/v1/inventory/journal/receipts${q}`)
      .send({ ingredientId: id.rice, quantity: 20, unit: 'KG', unitCost: 50 })
      .expect(201);
    await owner
      .post(`/api/v1/inventory/journal/receipts${q}`)
      .send({ ingredientId: id.milk, quantity: 10, unit: 'L', unitCost: 60 })
      .expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects invalid entries before anything is saved', async () => {
    // a transfer with no destination
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'TRANSFER',
        lines: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }],
      })
      .expect(400);
    // same place both sides
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'TRANSFER',
        lines: [
          {
            ingredientId: id.rice,
            quantity: '1',
            unit: 'KG',
            fromLocationId: id.store,
            toLocationId: id.store,
          },
        ],
      })
      .expect(400);
    // negative / zero quantity
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'CORRECTION',
        reason: 'Count',
        lines: [{ ingredientId: id.rice, quantity: '-2', unit: 'KG' }],
      })
      .expect(400);
    // waste without a reason, correction without a reason, waste adding stock
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'WASTE',
        lines: [{ ingredientId: id.milk, quantity: '1', unit: 'L' }],
      })
      .expect(400);
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'CORRECTION',
        lines: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }],
      })
      .expect(400);
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'WASTE',
        lines: [
          {
            ingredientId: id.milk,
            quantity: '1',
            unit: 'L',
            direction: 'IN',
            wasteReason: 'EXPIRED',
          },
        ],
      })
      .expect(400);
    // an item that cannot be converted (L for a KG item)
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'CORRECTION',
        reason: 'Count',
        lines: [{ ingredientId: id.rice, quantity: '1', unit: 'L' }],
      })
      .expect(400);
  });

  it('a draft changes nothing; posting moves stock between places once', async () => {
    const draft = await owner
      .post(`${E}${q}`)
      .send({
        type: 'TRANSFER',
        notes: 'Morning issue',
        lines: [
          {
            ingredientId: id.rice,
            quantity: '8',
            unit: 'KG',
            toLocationId: id.store,
          },
        ],
      })
      .expect(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.entryNo).toMatch(/^SJ-\d{8}-\d{3}$/);
    expect(await level(id.rice, id.store)).toBe('0');

    // edit the draft: 10 kg from unassigned into the store
    await owner
      .patch(`${E}/${draft.body.id}${q}`)
      .send({
        type: 'TRANSFER',
        lines: [
          {
            ingredientId: id.rice,
            quantity: '10',
            unit: 'KG',
            toLocationId: id.store,
          },
        ],
      })
      .expect(200);
    const posted = await owner
      .post(`${E}/${draft.body.id}/post${q}`)
      .expect(201);
    expect(posted.body.status).toBe('POSTED');
    expect(posted.body.postedByName).toBeTruthy();
    expect(await level(id.rice, id.store)).toBe('10');
    expect(await stock(id.rice)).toBe('20'); // a transfer never changes the total

    // posting twice is refused and changes nothing
    await owner.post(`${E}/${draft.body.id}/post${q}`).expect(409);
    expect(await level(id.rice, id.store)).toBe('10');
    // a posted entry cannot be edited or deleted
    await owner
      .patch(`${E}/${draft.body.id}${q}`)
      .send({
        type: 'TRANSFER',
        lines: [
          {
            ingredientId: id.rice,
            quantity: '1',
            unit: 'KG',
            toLocationId: id.store,
          },
        ],
      })
      .expect(400);
    await owner.delete(`${E}/${draft.body.id}${q}`).expect(400);

    // store -> kitchen, posted straight away, in grams
    const move = await owner
      .post(`${E}${q}`)
      .send({
        type: 'TRANSFER',
        post: true,
        lines: [
          {
            ingredientId: id.rice,
            quantity: '2500',
            unit: 'G',
            fromLocationId: id.store,
            toLocationId: id.kitchen,
          },
        ],
      })
      .expect(201);
    expect(await level(id.rice, id.store)).toBe('7.5');
    expect(await level(id.rice, id.kitchen)).toBe('2.5');
    // more than the place holds is refused, nothing moves
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'TRANSFER',
        post: true,
        lines: [
          {
            ingredientId: id.rice,
            quantity: '9',
            unit: 'KG',
            fromLocationId: id.store,
            toLocationId: id.kitchen,
          },
        ],
      })
      .expect(400);
    expect(await level(id.rice, id.store)).toBe('7.5');

    // reversal puts it back where it came from
    await owner
      .post(`${E}/${move.body.id}/void${q}`)
      .send({ reason: 'Wrong shelf' })
      .expect(201);
    expect(await level(id.rice, id.store)).toBe('10');
    expect(await level(id.rice, id.kitchen)).toBe('0');
    await owner
      .post(`${E}/${move.body.id}/void${q}`)
      .send({ reason: 'again' })
      .expect(400);
  });

  it('a retried post with the same key creates and posts once', async () => {
    const body = {
      type: 'CORRECTION',
      reason: 'Found a sack behind the shelf',
      post: true,
      idempotencyKey: `sje-retry-${tag}`,
      lines: [
        {
          ingredientId: id.rice,
          quantity: '1',
          unit: 'KG',
          direction: 'IN',
        },
      ],
    };
    const [a, b] = await Promise.all([
      owner.post(`${E}${q}`).send(body),
      owner.post(`${E}${q}`).send(body),
    ]);
    expect(a.body.id).toBe(b.body.id);
    expect(await stock(id.rice)).toBe('21');
  });

  it('correction down and up, value at average cost, then reversal', async () => {
    const c = await owner
      .post(`${E}${q}`)
      .send({
        type: 'CORRECTION',
        reason: 'Weekly count',
        post: true,
        lines: [
          {
            ingredientId: id.milk,
            quantity: '1.5',
            unit: 'L',
            direction: 'OUT',
          },
          {
            ingredientId: id.rice,
            quantity: '500',
            unit: 'G',
            direction: 'IN',
            toLocationId: id.kitchen,
          },
        ],
      })
      .expect(201);
    expect(await stock(id.milk)).toBe('8.5');
    expect(await stock(id.rice)).toBe('21.5');
    expect(await level(id.rice, id.kitchen)).toBe('0.5');
    // value: -1.5 x 60 + 0.5 x 50 = -65
    expect(c.body.value).toBe('-65');
    const moves = (
      await owner
        .get(`/api/v1/inventory/journal${q}&type=ADJUSTMENT`)
        .expect(200)
    ).body.items as { note: string }[];
    expect(moves.some((m) => m.note?.includes(c.body.entryNo))).toBe(true);

    // cannot take more than is in stock
    await owner
      .post(`${E}${q}`)
      .send({
        type: 'CORRECTION',
        reason: 'Typo',
        post: true,
        lines: [{ ingredientId: id.milk, quantity: '99', unit: 'L' }],
      })
      .expect(400);
    expect(await stock(id.milk)).toBe('8.5');

    await owner
      .post(`${E}/${c.body.id}/void${q}`)
      .send({ reason: 'Recounted' })
      .expect(201);
    expect(await stock(id.milk)).toBe('10');
    expect(await stock(id.rice)).toBe('21');
    expect(await level(id.rice, id.kitchen)).toBe('0');
  });

  it('waste writes a real waste record; the waste page cannot reverse it on its own', async () => {
    const w = await chef
      .post(`${E}${q}`)
      .send({
        type: 'WASTE',
        post: true,
        lines: [
          {
            ingredientId: id.milk,
            quantity: '2',
            unit: 'L',
            wasteReason: 'EXPIRED',
            note: 'Smelled sour',
          },
        ],
      })
      .expect(201);
    expect(w.body.status).toBe('POSTED');
    expect(await stock(id.milk)).toBe('8');
    const wasteId = w.body.lines[0].wasteEntryId as string;
    expect(wasteId).toBeTruthy();
    expect(w.body.lines[0].wasteStatus).toBe('POSTED');
    const wastes = (
      await owner
        .get(`/api/v1/inventory/waste/entries${q}&ingredientId=${id.milk}`)
        .expect(200)
    ).body as { id: string; reason: string }[];
    expect(wastes.some((x) => x.id === wasteId && x.reason === 'EXPIRED')).toBe(
      true,
    );
    await owner
      .post(`/api/v1/inventory/waste/entries/${wasteId}/reverse${q}`)
      .send({ reason: 'test' })
      .expect(400);

    // a chef cannot reverse (production.void) or move stock between places
    await chef
      .post(`${E}/${w.body.id}/void${q}`)
      .send({ reason: 'oops' })
      .expect(403);
    await chef
      .post(`${E}${q}`)
      .send({
        type: 'TRANSFER',
        lines: [
          {
            ingredientId: id.rice,
            quantity: '1',
            unit: 'KG',
            toLocationId: id.kitchen,
          },
        ],
      })
      .expect(403);
    await owner
      .post(`${E}/${w.body.id}/void${q}`)
      .send({ reason: 'It was fine' })
      .expect(201);
    expect(await stock(id.milk)).toBe('10');
    const after = await owner.get(`${E}/${w.body.id}${q}`).expect(200);
    expect(after.body.status).toBe('VOIDED');
    expect(after.body.lines[0].wasteStatus).toBe('REVERSED');
  });

  it('lists every kind in one place with search, filters and sort; cashiers are kept out', async () => {
    const all = (await owner.get(`${E}${q}`).expect(200)).body as {
      entryNo: string;
      kind: string;
      status: string;
    }[];
    expect(all.some((r) => r.kind === 'TRANSFER')).toBe(true);
    expect(all.some((r) => r.kind === 'WASTE')).toBe(true);
    expect(all.some((r) => r.kind === 'CORRECTION')).toBe(true);
    const voided = (
      await owner.get(`${E}${q}&status=VOIDED&type=WASTE`).expect(200)
    ).body as { kind: string; status: string }[];
    expect(voided.length).toBeGreaterThan(0);
    expect(
      voided.every((r) => r.kind === 'WASTE' && r.status === 'VOIDED'),
    ).toBe(true);
    const byItem = (
      await owner
        .get(`${E}${q}&q=${encodeURIComponent(`Milk-${tag}`)}`)
        .expect(200)
    ).body as { out: { name: string }[]; in: { name: string }[] }[];
    expect(byItem.length).toBeGreaterThan(0);
    expect(
      byItem.every((r) =>
        [...r.out, ...r.in].some((l) => l.name === `Milk-${tag}`),
      ),
    ).toBe(true);
    const byPlace = (
      await owner.get(`${E}${q}&locationId=${id.kitchen}`).expect(200)
    ).body as { places: string[] }[];
    expect(byPlace.every((r) => r.places.includes(`Kitchen-${tag}`))).toBe(
      true,
    );
    const asc = (
      await owner.get(`${E}${q}&sort=ref&dir=asc&type=TRANSFER`).expect(200)
    ).body as { entryNo: string }[];
    const nos = asc.map((r) => r.entryNo);
    expect(
      [...nos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ).toEqual(nos);
    // the chef sees waste and production, never transfers/corrections
    const chefRows = (await chef.get(`${E}${q}`).expect(200)).body as {
      kind: string;
    }[];
    expect(
      chefRows.every((r) => r.kind === 'WASTE' || r.kind === 'PRODUCTION'),
    ).toBe(true);
    await cashier.get(`${E}${q}`).expect(403);
    // the same filters as a spreadsheet: one row per item line
    const csv = (
      await owner.get(`${E}.csv${q}&type=TRANSFER&status=POSTED`).expect(200)
    ).text;
    expect(csv).toContain('Reference,Type,Status');
    expect(csv).toContain(`Rice-${tag}`);
    expect(csv).not.toContain('CORRECTION');
    await cashier.get(`${E}.csv${q}`).expect(403);
  });

  it('deleting a draft never lets two entries share a number', async () => {
    const mk = () =>
      owner
        .post(`${E}${q}`)
        .send({
          type: 'CORRECTION',
          reason: 'Draft numbering',
          lines: [{ ingredientId: id.rice, quantity: '1', unit: 'KG' }],
        })
        .expect(201);
    const a = await mk();
    const b = await mk();
    await owner.delete(`${E}/${a.body.id}${q}`).expect(200);
    const c = await mk();
    expect(c.body.entryNo).not.toBe(b.body.entryNo);
    await owner.delete(`${E}/${b.body.id}${q}`).expect(200);
    await owner.delete(`${E}/${c.body.id}${q}`).expect(200);
  });
});
