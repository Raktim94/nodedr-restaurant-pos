/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
//   TABLES_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand tables-bulk
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.TABLES_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);

run('Floor sections and bulk tables (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let floorId: string;
  let ids: string[];

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
    floorId = (await owner.post(`/api/v1/tables/floors${q}`).send({ name: `Rooftop ${tag}` }).expect(201)).body.id;
    await owner.post(`/api/v1/tables/floors${q}`).send({ name: `Garden ${tag}` }).expect(201);
  });
  afterAll(async () => {
    await prisma.floor.deleteMany({ where: { name: { in: [`Rooftop ${tag}`, `Garden ${tag}`] } } });
    await app.close();
  });

  it('creates several tables in one go, in a grid, with the chosen size and shape', async () => {
    const res = await owner.post(`/api/v1/tables/bulk${q}`).send({
      floorId, numbers: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], capacity: 4, shape: 'booth', width: 120, height: 60, columns: 3,
    }).expect(201);
    ids = res.body.map((t: { id: string }) => t.id);
    const t = res.body as { number: string; posX: number; posY: number; shape: string; width: number }[];
    expect(t.every((x) => x.shape === 'booth' && x.width === 120)).toBe(true);
    expect(t[0].posX).toBe(20);
    expect(t[1].posX).toBe(20 + 140);
    expect(t[3].posX).toBe(20); // fourth table starts the second row
    expect(t[3].posY).toBe(20 + 80);
  });

  it('refuses duplicate numbers on the same floor and unknown shapes', async () => {
    expect((await owner.post(`/api/v1/tables/bulk${q}`).send({ floorId, numbers: ['R1'], capacity: 2 })).status).toBe(400);
    expect((await owner.post(`/api/v1/tables/bulk${q}`).send({ floorId, numbers: ['Z1'], shape: 'hexagon' })).status).toBe(400);
  });

  it('changes seats and shape for a selection in one call', async () => {
    const res = await owner.patch(`/api/v1/tables/bulk${q}`).send({ ids: ids.slice(0, 3), capacity: 6, shape: 'counter' }).expect(200);
    expect(res.body.every((t: { capacity: number; shape: string }) => t.capacity === 6 && t.shape === 'counter')).toBe(true);
    expect((await owner.patch(`/api/v1/tables/bulk${q}`).send({ ids })).status).toBe(400);
  });

  it('will not delete a table that has an open order, singly or in a selection', async () => {
    const items = (await owner.get(`/api/v1/menu/items${q}`).expect(200)).body as { id: string }[];
    const order = (await owner.post(`/api/v1/orders${q}`).send({
      type: 'DINE_IN', tableId: ids[0], items: [{ menuItemId: items[0].id, quantity: 1, modifierIds: [] }],
    }).expect(201)).body;
    const single = await owner.delete(`/api/v1/tables/${ids[0]}${q}`);
    expect(single.status).toBe(409);
    expect(single.body.message).toMatch(/open order/);
    const bulk = await owner.post(`/api/v1/tables/bulk-delete${q}`).send({ ids });
    expect(bulk.status).toBe(409);
    expect(await prisma.table.count({ where: { id: { in: ids } } })).toBe(6); // all or nothing
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await prisma.table.updateMany({ where: { id: { in: ids } }, data: { status: 'AVAILABLE' } });
  });

  it('deletes empty tables in bulk once nothing is using them', async () => {
    const res = await owner.post(`/api/v1/tables/bulk-delete${q}`).send({ ids }).expect(201);
    expect(res.body.deleted).toBe(6);
  });
});
