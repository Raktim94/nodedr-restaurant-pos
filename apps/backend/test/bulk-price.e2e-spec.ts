/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Bulk menu price change by percentage.
//   BULKPRICE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand bulk-price
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.BULKPRICE_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';

run('Bulk price change (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let before: { id: string; price: unknown; halfPrice: unknown }[];
  const url = `/api/v1/menu/items/bulk-price?branchId=${BRANCH}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    before = await prisma.menuItem.findMany({
      where: { branchId: BRANCH },
      select: { id: true, price: true, halfPrice: true },
    });
  });

  afterAll(async () => {
    for (const b of before) {
      await prisma.menuItem.update({
        where: { id: b.id },
        data: { price: b.price as never, halfPrice: b.halfPrice as never },
      });
    }
    await app.close();
  });

  const cola = () =>
    prisma.menuItem.findUniqueOrThrow({ where: { id: 'demo-item-cola' } });

  it('preview changes nothing', async () => {
    const p = Number((await cola()).price);
    const r = await owner.post(url).send({ percent: 10, preview: true }).expect(201);
    expect(r.body.applied).toBe(false);
    expect(r.body.count).toBeGreaterThan(0);
    expect(Number((await cola()).price)).toBe(p);
  });

  it('positive percent raises, negative lowers, rounded to whole rupees', async () => {
    const p = Number((await cola()).price);
    await owner.post(url).send({ percent: 10 }).expect(201);
    expect(Number((await cola()).price)).toBe(Math.round(p * 1.1));
    const up = Number((await cola()).price);
    await owner.post(url).send({ percent: -10 }).expect(201);
    expect(Number((await cola()).price)).toBe(Math.round(up * 0.9));
  });

  it('rejects absurd percentages and never goes below zero', async () => {
    await owner.post(url).send({ percent: -100 }).expect(400);
    await owner.post(url).send({ percent: 1000 }).expect(400);
    await owner.post(url).send({ percent: -90 }).expect(201);
    expect(Number((await cola()).price)).toBeGreaterThanOrEqual(0);
  });

  it('can be limited to one category', async () => {
    const c = await cola();
    const other = await prisma.menuItem.findFirst({
      where: { branchId: BRANCH, categoryId: { not: c.categoryId } },
    });
    const o = other ? Number(other.price) : null;
    await owner.post(url).send({ percent: 50, categoryId: c.categoryId }).expect(201);
    if (other && o != null) {
      expect(Number((await prisma.menuItem.findUniqueOrThrow({ where: { id: other.id } })).price)).toBe(o);
    }
  });
});
