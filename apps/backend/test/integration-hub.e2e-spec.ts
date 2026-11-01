/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Integrations hub: encrypted credential storage, honest status, isolation.
//   HUB_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand integration-hub
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

process.env.ALLOW_PUBLIC_SIGNUP = 'true'; // creates a second restaurant
const run = process.env.HUB_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);
const SECRET = `sk_live_${tag}_SUPERSECRET`;
const H = '/api/v1/integration-hub';

run('Integrations hub (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  let restaurantId: string;

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
    restaurantId = (
      await prisma.branch.findUniqueOrThrow({ where: { id: 'demo-branch' } })
    ).restaurantId;
    // Start from a clean slate for these two providers.
    await prisma.integrationConnection.deleteMany({
      where: { restaurantId, provider: { in: ['zomato', 'swiggy'] } },
    });

    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `hub-cashier-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: 'Hub Cashier',
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: ['demo-branch'],
      })
      .expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);

    const oe = `hub-other-${tag}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ownerName: 'Other',
        email: oe,
        password: 'Password123!',
        restaurantName: `Other ${tag}`,
        branchName: 'Main',
      })
      .expect(201);
    other = request.agent(app.getHttpServer());
    await other
      .post('/api/v1/auth/login')
      .send({ email: oe, password: 'Password123!' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.integrationConnection.deleteMany({
      where: { restaurantId, provider: { in: ['zomato', 'swiggy'] } },
    });
    await app.close();
  });

  const zomato = async (a = owner) =>
    ((await a.get(H).expect(200)).body as any[]).find(
      (p) => p.key === 'zomato',
    );

  it('lists the providers with their declared capabilities, none connected', async () => {
    const z = await zomato();
    expect(z.category).toBe('FOOD_DELIVERY');
    expect(z.connection).toBeNull();
    expect(z.capabilities).toMatchObject({
      receiveOrders: true,
      webhooks: true,
      updateOrderStatus: false,
    });
    expect(z.credentialFields.map((f: any) => f.key)).toContain(
      'webhookSecret',
    );
    const keys = ((await owner.get(H).expect(200)).body as any[]).map(
      (p) => p.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining(['zomato', 'swiggy', 'aggregator']),
    );
  });

  it('validates what is saved', async () => {
    await owner.put(`${H}/zomato`).send({ credentials: {} }).expect(400); // nothing required given
    const r = await owner
      .put(`${H}/zomato`)
      .send({ externalAccountId: 'M1', credentials: { bogus: 'x' } });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Unknown credential field/);
    await owner.put(`${H}/nope`).send({ credentials: {} }).expect(404);
  });

  it('saves credentials encrypted and never echoes them back', async () => {
    const res = await owner
      .put(`${H}/zomato`)
      .send({
        externalAccountId: 'MERCH-42',
        credentials: { webhookSecret: SECRET },
      })
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.status).toBe('PENDING_CONFIGURATION');
    expect(res.body.credentialsSet).toEqual({ webhookSecret: true });
    expect(res.body.externalAccountId).toBe('MERCH-42');

    // Not in any later read either.
    expect(JSON.stringify((await owner.get(H).expect(200)).body)).not.toContain(
      SECRET,
    );

    // And not in the database in clear text.
    const row = await prisma.integrationConnection.findFirstOrThrow({
      where: { restaurantId, provider: 'zomato' },
    });
    expect(row.credentialsEnc).toMatch(/^v1\./);
    expect(row.credentialsEnc).not.toContain(SECRET);
    expect(JSON.stringify(row.config)).not.toContain(SECRET);
  });

  it('never reports CONNECTED without an adapter-observed success', async () => {
    const res = await owner.post(`${H}/zomato/test`).expect(201);
    expect(res.body.ok).toBe(false);
    expect(res.body.connection.status).toBe('PENDING_CONFIGURATION');
    expect(res.body.message).toMatch(/waiting for the first signed delivery/i);
    expect(res.body.connection.lastError).toBeTruthy();
    expect(res.body.connection.lastSuccessAt).toBeNull();
    expect(res.body.connection.lastSyncAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('keeps stored secrets when only another field changes', async () => {
    await owner
      .put(`${H}/zomato`)
      .send({ externalAccountId: 'MERCH-43', credentials: {} })
      .expect(200);
    const z = await zomato();
    expect(z.connection.externalAccountId).toBe('MERCH-43');
    expect(z.connection.credentialsSet).toEqual({ webhookSecret: true });
    // Still decryptable: a test reaches the adapter instead of failing to read.
    const t = await owner.post(`${H}/zomato/test`).expect(201);
    expect(t.body.connection.status).toBe('PENDING_CONFIGURATION');
  });

  it('writes an activity log without secrets, and audits changes without bodies', async () => {
    const logs = (await owner.get(`${H}/zomato/logs`).expect(200))
      .body as any[];
    expect(logs.map((l) => l.event)).toEqual(
      expect.arrayContaining(['credentials_saved', 'test']),
    );
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    const audits = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'integration.' } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(SECRET);
  });

  it('disabling blocks testing; enabling asks for a fresh test', async () => {
    const off = await owner
      .post(`${H}/zomato/enabled`)
      .send({ enabled: false })
      .expect(201);
    expect(off.body.status).toBe('DISABLED');
    expect((await owner.post(`${H}/zomato/test`)).status).toBe(400);
    const on = await owner
      .post(`${H}/zomato/enabled`)
      .send({ enabled: true })
      .expect(201);
    expect(on.body.status).toBe('PENDING_CONFIGURATION');
  });

  it('is closed to staff without settings.manage and to anonymous callers', async () => {
    await cashier.get(H).expect(403);
    await cashier.put(`${H}/zomato`).send({ credentials: {} }).expect(403);
    await cashier.post(`${H}/zomato/test`).expect(403);
    await cashier.delete(`${H}/zomato`).expect(403);
    await request(app.getHttpServer()).get(H).expect(401);
  });

  it('another restaurant sees none of it and cannot touch it', async () => {
    expect((await zomato(other)).connection).toBeNull();
    await other.get(`${H}/zomato/logs`).expect(404);
    await other.post(`${H}/zomato/test`).expect(404);
    await other.delete(`${H}/zomato`).expect(404);
    // Their own connection is independent of ours.
    await other
      .put(`${H}/zomato`)
      .send({
        externalAccountId: 'THEIRS',
        credentials: { webhookSecret: 'their-own-key-0123456789' },
      })
      .expect(200);
    expect((await zomato()).connection.externalAccountId).toBe('MERCH-43');
  });

  it('a ciphertext copied into another restaurant cannot be decrypted', async () => {
    const mine = await prisma.integrationConnection.findFirstOrThrow({
      where: { restaurantId, provider: 'zomato' },
    });
    const theirs = await prisma.integrationConnection.findFirstOrThrow({
      where: { provider: 'zomato', NOT: { restaurantId } },
    });
    try {
      await prisma.integrationConnection.update({
        where: { id: theirs.id },
        data: { credentialsEnc: mine.credentialsEnc },
      });
      const res = await other.post(`${H}/zomato/test`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/can no longer be read/);
      expect((await zomato(other)).connection.status).toBe('AUTH_EXPIRED');
    } finally {
      await prisma.integrationConnection.delete({ where: { id: theirs.id } });
    }
  });

  it('disconnecting removes the credentials and the log', async () => {
    await owner.delete(`${H}/zomato`).expect(200);
    expect(
      await prisma.integrationConnection.count({
        where: { restaurantId, provider: 'zomato' },
      }),
    ).toBe(0);
    expect((await zomato()).connection).toBeNull();
    await owner.get(`${H}/zomato/logs`).expect(404);
  });
});
