/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// An admin changing a staff member's password must end that person's existing sessions
// (a stolen cookie must not outlive the password reset). Opt-in:
//   REVOKE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand session-revocation
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.REVOKE_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);

run('Session revocation on password change (e2e)', () => {
  let app: INestApplication<App>;
  let owner: ReturnType<typeof request.agent>;

  const login = async (email: string, password: string, expected = 201) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/api/v1/auth/login').send({ email, password }).expect(expected);
    return a;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
      })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    owner = await login('owner@demo.local', 'Password123!');
  });
  afterAll(async () => {
    await app.close();
  });

  it('kills the old session on a password change, lets the new password in, and spares other users', async () => {
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const mk = async (n: string) => {
      const email = `${n}-${tag}@demo.local`;
      const res = await owner
        .post('/api/v1/users')
        .send({ name: n, email, password: 'Password123!', roleId: roles.find((r) => r.name === 'WAITER')!.id, branchIds: ['demo-branch'] })
        .expect(201);
      return { email, id: res.body.id as string };
    };
    const victim = await mk('victim');
    const bystander = await mk('bystander');
    const stolen = await login(victim.email, 'Password123!');
    const other = await login(bystander.email, 'Password123!');
    await stolen.get('/api/v1/auth/me').expect(200);

    // Cookies are second-resolution: make sure the reset lands in a later second than the login.
    await new Promise((r) => setTimeout(r, 1100));
    await owner.patch(`/api/v1/users/${victim.id}`).send({ password: 'NewPassw0rd!x' }).expect(200);

    await stolen.get('/api/v1/auth/me').expect(401);
    await login(victim.email, 'Password123!', 401);
    const fresh = await login(victim.email, 'NewPassw0rd!x');
    await fresh.get('/api/v1/auth/me').expect(200);
    await other.get('/api/v1/auth/me').expect(200);
  });
});
