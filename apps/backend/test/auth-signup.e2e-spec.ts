/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped by design */
// Sign-up is first-run setup: closed once the server has a restaurant, unless
// the host opts in.
//   SIGNUP_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand auth-signup
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.SIGNUP_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);

run('Sign-up is closed after first run (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const body = (n: string) => ({
    ownerName: 'Intruder',
    email: `intruder-${n}-${tag}@example.com`,
    password: 'Password123!',
    restaurantName: `Intruder ${n} ${tag}`,
    branchName: 'Main',
  });
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.ALLOW_PUBLIC_SIGNUP;
    delete process.env.ALLOW_PUBLIC_SIGNUP;
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
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.ALLOW_PUBLIC_SIGNUP;
    else process.env.ALLOW_PUBLIC_SIGNUP = previous;
    await app.close();
  });

  it('refuses a stranger once the server already has a restaurant', async () => {
    const before = await prisma.restaurant.count();
    expect(before).toBeGreaterThan(0);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(body('closed'));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/closed/i);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.restaurant.count()).toBe(before);
    expect(
      await prisma.user.count({ where: { email: body('closed').email } }),
    ).toBe(0);
  });

  it('setup-status still tells the UI the server is set up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/setup-status')
      .expect(200);
    expect(res.body.isSetup).toBe(true);
  });

  it('opens again only when the host sets ALLOW_PUBLIC_SIGNUP=true', async () => {
    process.env.ALLOW_PUBLIC_SIGNUP = 'true';
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(body('open'))
        .expect(201);
      const restaurant = await prisma.restaurant.findFirstOrThrow({
        where: { name: body('open').restaurantName },
        include: { branches: true },
      });
      expect(restaurant).toMatchObject({
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        branches: [
          { country: 'IN', taxRegime: 'INDIA_GST', taxMode: 'INCLUSIVE' },
        ],
      });
    } finally {
      delete process.env.ALLOW_PUBLIC_SIGNUP;
    }
  });

  describe('regional settings at sign-up', () => {
    beforeEach(() => {
      process.env.ALLOW_PUBLIC_SIGNUP = 'true';
    });
    afterEach(() => {
      delete process.env.ALLOW_PUBLIC_SIGNUP;
    });

    const brazil = {
      country: 'BR',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      taxRegime: 'CUSTOM',
    };

    it.each([
      [brazil, 'INCLUSIVE'],
      [
        {
          country: 'US',
          currency: 'USD',
          timezone: 'America/Chicago',
          taxRegime: 'US_SALES_TAX',
        },
        'EXCLUSIVE',
      ],
    ] as const)(
      'stores %o for the owner and first branch',
      async (regionalSettings, taxMode) => {
        const signup = body(regionalSettings.country);
        const owner = request.agent(app.getHttpServer());
        await owner
          .post('/api/v1/auth/register')
          .send({ ...signup, regionalSettings })
          .expect(201);
        const [branch] = (await owner.get('/api/v1/branches').expect(200))
          .body as { id: string }[];
        const settings = await owner
          .get('/api/v1/settings/display')
          .query({ branchId: branch.id })
          .expect(200);
        expect(settings.body.restaurant).toMatchObject({
          currency: regionalSettings.currency,
          timezone: regionalSettings.timezone,
        });
        expect(settings.body.branch).toMatchObject({
          country: regionalSettings.country,
          taxRegime: regionalSettings.taxRegime,
          taxMode,
        });
      },
    );

    it.each([
      { currency: undefined },
      { currency: 'ZZZ' },
      { timezone: 'Mars/Base' },
      { timezone: '+05:30' },
      { country: 'XX' },
      { taxRegime: 'UNKNOWN' },
    ])('rejects %o before creating the restaurant', async (invalid) => {
      const signup = body(randomUUID());
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...signup, regionalSettings: { ...brazil, ...invalid } })
        .expect(400);
      expect(
        await prisma.restaurant.count({
          where: { name: signup.restaurantName },
        }),
      ).toBe(0);
    });

    it('validates later regional edits and retains the country when changing the tax regime', async () => {
      const owner = request.agent(app.getHttpServer());
      await owner
        .post('/api/v1/auth/register')
        .send({ ...body('edit'), regionalSettings: brazil })
        .expect(201);
      const [branch] = (await owner.get('/api/v1/branches').expect(200))
        .body as { id: string }[];
      const restaurantSettings = '/api/v1/settings/restaurant';
      const branchSettings = '/api/v1/settings/branch';
      await owner
        .patch(restaurantSettings)
        .send({ currency: 'ZZZ' })
        .expect(400);
      await owner
        .patch(restaurantSettings)
        .send({ timezone: 'Missing/Zone' })
        .expect(400);
      await owner
        .patch(branchSettings)
        .query({ branchId: branch.id })
        .send({ country: 'XX' })
        .expect(400);
      await owner
        .patch(restaurantSettings)
        .send({ currency: ' eur ', timezone: 'UTC' })
        .expect(200);
      await owner
        .patch(branchSettings)
        .query({ branchId: branch.id })
        .send({ taxRegime: 'EU_VAT' })
        .expect(200);
      const settings = await owner
        .get('/api/v1/settings/display')
        .query({ branchId: branch.id })
        .expect(200);
      expect(settings.body.restaurant).toMatchObject({
        currency: 'EUR',
        timezone: 'UTC',
      });
      expect(settings.body.branch).toMatchObject({
        country: 'BR',
        taxRegime: 'EU_VAT',
      });
    });
  });

  it('login and existing owners are unaffected', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
  });
});
