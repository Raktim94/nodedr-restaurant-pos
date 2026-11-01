/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Mobile app backend: device registration, version check, account deletion.
//   MOBILE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand mobile
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.MOBILE_E2E ? describe : describe.skip;
const tag = String(Date.now()).slice(-6);
const TOKEN = `fcm-token-${tag}-`.padEnd(40, 'x');

run('Mobile backend (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let staffId: string;
  const staffPhone = `9${tag}77`;
  const http = () => request(app.getHttpServer());

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
    const me = (await owner.get('/api/v1/auth/me').expect(200)).body.user;
    const role = await prisma.role.findFirstOrThrow({
      where: { restaurantId: me.restaurantId, name: 'DELIVERY_STAFF' },
    });
    const u = await prisma.user.create({
      data: {
        restaurantId: me.restaurantId,
        roleId: role.id,
        name: 'Mobile Tester',
        phone: staffPhone,
        passwordHash: await bcrypt.hash('RiderPass123!', 10),
      },
    });
    staffId = u.id;
  });

  afterAll(async () => {
    await prisma.deviceToken.deleteMany({ where: { token: TOKEN } });
    await prisma.user.deleteMany({ where: { id: staffId } }).catch(() => undefined);
    await app.close();
  });

  it('version check is public', async () => {
    const r = await http().get('/api/v1/mobile/config').expect(200);
    expect(r.body.minVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof r.body.push).toBe('boolean');
  });

  it('registering a device needs sign-in and is idempotent', async () => {
    await http().post('/api/v1/devices').send({ token: TOKEN, platform: 'ANDROID' }).expect(401);
    await owner.post('/api/v1/devices').send({ token: TOKEN, platform: 'ANDROID', appVersion: '1.0.0' }).expect(201);
    await owner.post('/api/v1/devices').send({ token: TOKEN, platform: 'ANDROID', appVersion: '1.0.1' }).expect(201);
    expect(await prisma.deviceToken.count({ where: { token: TOKEN } })).toBe(1);
    await owner.post('/api/v1/devices').send({ token: 'short', platform: 'ANDROID' }).expect(400);
    await owner.delete(`/api/v1/devices/${TOKEN}`).expect(200);
    expect(await prisma.deviceToken.count({ where: { token: TOKEN } })).toBe(0);
  });

  it('a rider can sign in by phone, register a phone and delete their own account', async () => {
    const rider = request.agent(app.getHttpServer());
    await rider.post('/api/v1/auth/login').send({ email: staffPhone, password: 'RiderPass123!' }).expect(201);
    await rider.post('/api/v1/devices').send({ token: TOKEN, platform: 'IOS' }).expect(201);
    // wrong password
    await rider.delete('/api/v1/auth/me').send({ password: 'nope' }).expect(401);
    await rider.delete('/api/v1/auth/me').send({ password: 'RiderPass123!' }).expect(200);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(gone.isActive).toBe(false);
    expect(gone.phone).toBeNull();
    expect(gone.name).toBe('Deleted user');
    expect(await prisma.deviceToken.count({ where: { token: TOKEN } })).toBe(0);
    // cannot sign in again
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: staffPhone, password: 'RiderPass123!' })
      .expect(401);
  });

  it('the only owner cannot delete the account', async () => {
    await owner.delete('/api/v1/auth/me').send({ password: 'Password123!' }).expect(409);
  });
});
