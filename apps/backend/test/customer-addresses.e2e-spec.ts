/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Saved delivery addresses: CRUD, single default, validation, tenant isolation.
//   ADDRESSES_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand customer-addresses
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.ADDRESSES_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
// These suites create a second restaurant, which needs sign-up opened (it is closed by default).
process.env.ALLOW_PUBLIC_SIGNUP = 'true';
const tag = randomUUID().slice(0, 6);

run('Customer addresses (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let customerId: string;
  const base = () => `/api/v1/customers/${customerId}/addresses`;

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
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    customerId = (
      await owner
        .post(`/api/v1/customers${q}`)
        .send({
          name: `Addr ${tag}`,
          phone: `99${Math.floor(Math.random() * 1e8)}`,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.customer.delete({ where: { id: customerId } });
    await app.close();
  });

  it('the first address becomes the default', async () => {
    const res = await owner
      .post(`${base()}${q}`)
      .send({
        label: 'Home',
        line1: '12B Rose Apts',
        street: 'MG Road',
        city: 'Pune',
        state: 'MH',
        pincode: '411001',
        landmark: 'Opp. Metro',
      })
      .expect(201);
    expect(res.body.isDefault).toBe(true);
  });

  it('keeps exactly one default when another is made default', async () => {
    const office = (
      await owner
        .post(`${base()}${q}`)
        .send({
          label: 'Office',
          line1: '4th Floor, Tech Park',
          pincode: '411014',
          instructions: 'Call at gate',
        })
        .expect(201)
    ).body;
    expect(office.isDefault).toBe(false);
    await owner
      .patch(`${base()}/${office.id}${q}`)
      .send({ isDefault: true })
      .expect(200);
    const list = (await owner.get(`${base()}${q}`).expect(200)).body;
    expect(list).toHaveLength(2);
    expect(list.filter((a: any) => a.isDefault)).toHaveLength(1);
    expect(list[0].label).toBe('Office');
  });

  it('cannot un-default the only default; deleting it promotes another', async () => {
    const list = (await owner.get(`${base()}${q}`).expect(200)).body;
    const def = list.find((a: any) => a.isDefault);
    const stillDef = (
      await owner
        .patch(`${base()}/${def.id}${q}`)
        .send({ isDefault: false })
        .expect(200)
    ).body;
    expect(stillDef.isDefault).toBe(true);
    await owner.delete(`${base()}/${def.id}${q}`).expect(200);
    const after = (await owner.get(`${base()}${q}`).expect(200)).body;
    expect(after).toHaveLength(1);
    expect(after[0].isDefault).toBe(true);
  });

  it('validates input', async () => {
    await owner.post(`${base()}${q}`).send({ label: 'x' }).expect(400);
    await owner
      .post(`${base()}${q}`)
      .send({ line1: 'ok', pincode: '<script>' })
      .expect(400);
  });

  it('comes back on the customer record', async () => {
    const res = await owner
      .get(`/api/v1/customers/${customerId}${q}`)
      .expect(200);
    expect(res.body.addresses).toHaveLength(1);
  });

  it('is invisible and untouchable from another restaurant', async () => {
    const email = `other-${tag}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ownerName: 'Other',
        email,
        password: 'Password123!',
        restaurantName: `Other ${tag}`,
        branchName: 'Main',
      })
      .expect(201);
    const other = request.agent(app.getHttpServer());
    await other
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    const otherBranch = (await other.get('/api/v1/branches').expect(200))
      .body[0].id;
    const oq = `?branchId=${otherBranch}`;
    const mine = (await owner.get(`${base()}${q}`).expect(200)).body[0];
    // Own branch id + someone else's customer id: not found.
    await other.get(`${base()}${oq}`).expect(404);
    await other
      .patch(`${base()}/${mine.id}${oq}`)
      .send({ line1: 'hijack' })
      .expect(404);
    await other.delete(`${base()}/${mine.id}${oq}`).expect(404);
    // Someone else's branch id: access refused.
    await other.get(`${base()}${q}`).expect(403);
    expect(
      (
        await prisma.customerAddress.findUniqueOrThrow({
          where: { id: mine.id },
        })
      ).line1,
    ).not.toBe('hijack');
  });
});
