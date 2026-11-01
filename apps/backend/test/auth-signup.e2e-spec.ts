/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
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
    } finally {
      delete process.env.ALLOW_PUBLIC_SIGNUP;
    }
  });

  it('login and existing owners are unaffected', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
  });
});
