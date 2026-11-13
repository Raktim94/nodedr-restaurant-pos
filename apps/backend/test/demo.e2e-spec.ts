/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// The public demo: no-password entry that works only when DEMO_MODE is on, and is fenced in.
//   DEMO_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand demo
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.DEMO_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;

run('Public demo mode (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
  });
  afterAll(async () => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_USER_EMAIL;
    await app.close();
  });

  it('is invisible and refused when DEMO_MODE is off', async () => {
    delete process.env.DEMO_MODE;
    expect((await request(app.getHttpServer()).get('/api/v1/public/demo-info').expect(200)).body).toEqual({ demo: false });
    expect((await request(app.getHttpServer()).post('/api/v1/auth/demo-login')).status).toBe(404);
  });

  it('signs a visitor in with no password when on, tells the app when it resets, and fences them in', async () => {
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_USER_EMAIL = 'owner@demo.local'; // stands in for the demo user
    process.env.DEMO_RESET_HOURS = '3';
    const info = (await request(app.getHttpServer()).get('/api/v1/public/demo-info').expect(200)).body;
    expect(info.demo).toBe(true);
    expect(info.resetEveryHours).toBe(3);
    expect(new Date(info.nextResetAt).getTime()).toBeGreaterThan(Date.now());
    const visitor = request.agent(app.getHttpServer());
    const login = await visitor.post('/api/v1/auth/demo-login').expect(201);
    expect(login.body.user.name).toBeTruthy();
    // works: reading and ordinary use
    await visitor.get(`/api/v1/menu/items${q}`).expect(200);
    await visitor.get(`/api/v1/inventory/ingredients${q}`).expect(200);
    // fenced: things that could hurt the server or other people
    for (const [m, path] of [['post', '/api/v1/users'], ['post', '/api/v1/webhooks'], ['patch', '/api/v1/roles/x'], ['post', '/api/v1/display/media'], ['post', '/api/v1/inventory/waste/photo'], ['post', '/api/v1/api-keys']] as const) {
      const r = await visitor[m](`${path}${q}`).send({});
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('DEMO_RESTRICTED');
    }
    // a webhook buzzer cannot be pointed at an address the visitor chooses
    const wh = await visitor.post(`/api/v1/paging/buzzers${q}`).send({ name: `Hook ${Date.now()}`, driver: 'WEBHOOK', webhookUrl: 'http://169.254.169.254/latest' });
    expect(wh.status).toBe(400);
    // a normal (non-demo) session is not fenced
    delete process.env.DEMO_MODE;
    const normal = request.agent(app.getHttpServer());
    await normal.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    expect((await normal.get(`/api/v1/menu/items${q}`)).status).toBe(200);
  });

  it('the demo user has no password sign-in: the guard only applies to demo sessions', async () => {
    process.env.DEMO_MODE = 'true';
    const normal = request.agent(app.getHttpServer());
    await normal.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const r = await normal.post(`/api/v1/webhooks${q}`).send({});
    expect(r.status).not.toBe(403); // a real password session is a real admin, even on the demo host
    delete process.env.DEMO_MODE;
  });
});
