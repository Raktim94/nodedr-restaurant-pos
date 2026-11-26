/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest bodies are untyped by design */
//   RESERVATIONS_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand reservations
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.RESERVATIONS_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
const at = (hours: number) =>
  new Date(Date.UTC(2031, 0, 15, hours, 0, 0)).toISOString();

run('Reservations and waitlist keep tables consistent (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let floorId: string;
  const tables: Record<string, string> = {};

  const book = (tableId: string, hours: number, minutes = 90) =>
    owner.post(`/api/v1/reservations${q}`).send({
      customerName: `Guest ${tag}`,
      guestCount: 2,
      reservedAt: at(hours),
      durationMinutes: minutes,
      tableId,
    });
  const tableStatus = async (id: string) =>
    (await prisma.table.findUniqueOrThrow({ where: { id } })).status;

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
    floorId = (
      await owner
        .post(`/api/v1/tables/floors${q}`)
        .send({ name: `Rsv ${tag}` })
        .expect(201)
    ).body.id;
    for (const n of ['A', 'B', 'C', 'D']) {
      tables[n] = (
        await owner
          .post(`/api/v1/tables${q}`)
          .send({ floorId, number: `${n}-${tag}`, capacity: 4 })
          .expect(201)
      ).body.id;
    }
  });
  afterAll(async () => {
    await prisma.reservation.deleteMany({
      where: { customerName: `Guest ${tag}` },
    });
    await prisma.waitlistEntry.deleteMany({
      where: { customerName: `Wait ${tag}` },
    });
    await prisma.floor.deleteMany({ where: { id: floorId } });
    await app.close();
  });

  it('rejects an overlapping booking on the same table, allows back-to-back and other tables', async () => {
    await book(tables.A, 19).expect(201); // 19:00-20:30
    const clash = await book(tables.A, 20); // 20:00 overlaps
    expect(clash.status).toBe(409);
    await book(tables.A, 20, 30).expect(409); // even a short one inside the window
    await book(tables.A, 17).expect(201); // 17:00-18:30 ends before 19:00
    await book(tables.A, 21).expect(201); // 21:00 starts after 20:30
    await book(tables.B, 19).expect(201); // another table, same time
  });

  it('two simultaneous bookings for one table produce exactly one', async () => {
    const [x, y] = await Promise.all([book(tables.C, 12), book(tables.C, 12)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });

  it('only allows forward status changes and keeps the table in step', async () => {
    const r = (await book(tables.D, 10).expect(201)).body;
    expect(await tableStatus(tables.D)).toBe('RESERVED');
    const set = (status: string) =>
      owner.patch(`/api/v1/reservations/${r.id}/status${q}`).send({ status });

    await set('ARRIVED').expect(200);
    expect(await tableStatus(tables.D)).toBe('OCCUPIED');
    await set('ARRIVED').expect(200); // a retry changes nothing
    expect((await set('RESERVED')).status).toBe(400); // cannot un-arrive
    expect((await set('CONFIRMED')).status).toBe(400);
    expect(await tableStatus(tables.D)).toBe('OCCUPIED');

    await set('COMPLETED').expect(200);
    expect(await tableStatus(tables.D)).toBe('AVAILABLE');
    expect((await set('ARRIVED')).status).toBe(400); // finished is final
    expect(await tableStatus(tables.D)).toBe('AVAILABLE');
  });

  it('cancelling one booking keeps the table reserved while another still holds it', async () => {
    const a = (await book(tables.B, 8).expect(201)).body;
    await owner
      .patch(`/api/v1/reservations/${a.id}/status${q}`)
      .send({ status: 'CANCELLED' })
      .expect(200);
    // tables.B still has the 19:00 booking from the first test
    expect(await tableStatus(tables.B)).toBe('RESERVED');
  });

  it('refuses to seat a waitlist party at a reserved or occupied table, and seats at a free one', async () => {
    const w = (
      await owner
        .post(`/api/v1/waitlist${q}`)
        .send({ customerName: `Wait ${tag}`, partySize: 2 })
        .expect(201)
    ).body;
    const seat = (tableId: string) =>
      owner.post(`/api/v1/waitlist/${w.id}/seat${q}`).send({ tableId });
    expect((await seat(tables.A)).status).toBe(409); // reserved
    await prisma.table.update({
      where: { id: tables.C },
      data: { status: 'OCCUPIED' },
    });
    expect((await seat(tables.C)).status).toBe(409); // occupied
    await prisma.table.update({
      where: { id: tables.C },
      data: { status: 'AVAILABLE' },
    });
    await prisma.reservation.deleteMany({ where: { tableId: tables.C } });
    await seat(tables.C).expect(201);
    expect(await tableStatus(tables.C)).toBe('OCCUPIED');
  });
});
