/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Customer PIN code and status: persisted, validated, clearable, existing customers unaffected.
//   CUSTOMER_PIN_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand customers-pincode
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.CUSTOMER_PIN_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
// These suites create a second restaurant, which needs sign-up opened (it is closed by default).
process.env.ALLOW_PUBLIC_SIGNUP = 'true';
const tag = randomUUID().slice(0, 6);

run('Customer PIN code and status (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let customerId: string;

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
          name: `Pin ${tag}`,
          phone: `99${Math.floor(Math.random() * 1e8)}`,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.customer.delete({ where: { id: customerId } });
    await app.close();
  });

  it('a customer created without the new fields is ACTIVE with no PIN code', async () => {
    const c = (
      await owner.get(`/api/v1/customers/${customerId}${q}`).expect(200)
    ).body;
    expect(c.status).toBe('ACTIVE');
    expect(c.pincode).toBeNull();
  });

  it('stores address, PIN code and status and shows them on the details', async () => {
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ address: '12 Rose Apts', pincode: '411001', status: 'INACTIVE' })
      .expect(200);
    const c = (
      await owner.get(`/api/v1/customers/${customerId}${q}`).expect(200)
    ).body;
    expect(c).toMatchObject({
      address: '12 Rose Apts',
      pincode: '411001',
      status: 'INACTIVE',
    });
  });

  it('rejects an invalid PIN code and an unknown status, changing nothing', async () => {
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ pincode: '12' })
      .expect(400);
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ pincode: '<script>' })
      .expect(400);
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ status: 'BANNED' })
      .expect(400);
    const c = (
      await owner.get(`/api/v1/customers/${customerId}${q}`).expect(200)
    ).body;
    expect(c.pincode).toBe('411001');
  });

  it('an empty PIN code clears it; other fields are untouched', async () => {
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ pincode: '' })
      .expect(200);
    const c = (
      await owner.get(`/api/v1/customers/${customerId}${q}`).expect(200)
    ).body;
    expect(c.pincode).toBeNull();
    expect(c.address).toBe('12 Rose Apts');
    expect(c.status).toBe('INACTIVE');
  });

  it('editing one field never overwrites the others', async () => {
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ phone: '9000000002', notes: 'likes tea' })
      .expect(200);
    await owner
      .patch(`/api/v1/customers/${customerId}${q}`)
      .send({ name: `Pin ${tag} renamed` })
      .expect(200);
    const c = (
      await owner.get(`/api/v1/customers/${customerId}${q}`).expect(200)
    ).body;
    expect(c).toMatchObject({
      name: `Pin ${tag} renamed`,
      phone: '9000000002',
      notes: 'likes tea',
      address: '12 Rose Apts',
      status: 'INACTIVE',
    });
  });

  it('the customer list returns address, PIN code and status for order selection', async () => {
    const list = (
      await owner.get(`/api/v1/customers${q}&search=${tag}`).expect(200)
    ).body as { id: string; address: string; status: string }[];
    expect(list.find((x) => x.id === customerId)).toMatchObject({
      address: '12 Rose Apts',
      status: 'INACTIVE',
    });
  });

  it('creates a customer with the new fields in one call', async () => {
    const r = await owner
      .post(`/api/v1/customers${q}`)
      .send({
        name: `New ${tag}`,
        phone: '9000000001',
        address: 'Main St',
        pincode: 'SW1A 1AA',
        status: 'ACTIVE',
      })
      .expect(201);
    expect(r.body).toMatchObject({ pincode: 'SW1A 1AA', status: 'ACTIVE' });
    await prisma.customer.delete({ where: { id: r.body.id } });
  });
});
