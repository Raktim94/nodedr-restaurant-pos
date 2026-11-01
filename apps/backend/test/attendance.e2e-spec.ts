/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Attendance: clock in/out, the double-shift race, audited corrections, and the
// payroll lock.
//   ATTENDANCE_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand attendance
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
const run = process.env.ATTENDANCE_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
const A = '/api/v1/attendance';
type Agent = ReturnType<typeof request.agent>;

run('Attendance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: Agent;
  let waiter: Agent;
  let cashier: Agent;
  let other: Agent;
  let waiterId: string;
  let recId: string;

  const mkUser = async (name: string, role: string) => {
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `${name}-${tag}@demo.local`;
    const res = await owner
      .post('/api/v1/users')
      .send({
        name: `${name} ${tag}`,
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === role)!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    const a = request.agent(app.getHttpServer());
    await a
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    return { agent: a, id: res.body.id as string };
  };

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
    const w = await mkUser('att-waiter', 'WAITER');
    waiter = w.agent;
    waiterId = w.id;
    cashier = (await mkUser('att-cashier', 'CASHIER')).agent;

    const oe = `att-other-${tag}@example.com`;
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
    await prisma.payrollRun.deleteMany({
      where: { branchId: BRANCH, periodStart: { lt: new Date('2000-01-01') } },
    });
    await prisma.attendance.deleteMany({ where: { userId: waiterId } });
    await app.close();
  });

  it('clocks in, shows the open shift, clocks out', async () => {
    expect((await waiter.get(`${A}/me`).expect(200)).body.id).toBeUndefined();
    const inn = await waiter
      .post(`${A}/clock-in`)
      .send({ branchId: BRANCH, note: 'opening' })
      .expect(201);
    recId = inn.body.id;
    expect((await waiter.get(`${A}/me`).expect(200)).body.id).toBe(recId);
    const out = await waiter.post(`${A}/clock-out`).send({}).expect(201);
    expect(out.body.clockOutAt).toBeTruthy();
    expect((await waiter.get(`${A}/me`).expect(200)).body.id).toBeUndefined();
  });

  it('refuses clocking out when not clocked in', async () => {
    const r = await waiter.post(`${A}/clock-out`).send({});
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Not clocked in/);
  });

  it('a burst of simultaneous clock-ins opens exactly one shift', async () => {
    // Many at once: two is too few to reliably land inside the check-then-insert window.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        waiter.post(`${A}/clock-in`).send({ branchId: BRANCH }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(11);
    const open = await prisma.attendance.count({
      where: { userId: waiterId, clockOutAt: null },
    });
    expect(open).toBe(1);
    await waiter.post(`${A}/clock-out`).send({}).expect(201);
  });

  it('validates input and the branch', async () => {
    await waiter
      .post(`${A}/clock-in`)
      .send({ branchId: BRANCH, note: 'x'.repeat(201) })
      .expect(400);
    await waiter.post(`${A}/clock-in`).send({}).expect(400);
    // A branch of another restaurant is refused outright.
    const otherBranch = (await other.get('/api/v1/branches').expect(200))
      .body[0].id;
    await waiter
      .post(`${A}/clock-in`)
      .send({ branchId: otherBranch })
      .expect(403);
    expect(
      await prisma.attendance.count({ where: { branchId: otherBranch } }),
    ).toBe(0);
  });

  it('only attendance managers can list or correct', async () => {
    await cashier.get(`${A}${q}`).expect(403);
    await cashier
      .patch(`${A}/${recId}`)
      .send({ note: 'x', reason: 'because' })
      .expect(403);
    const list = await owner.get(`${A}${q}`).expect(200);
    expect(list.body.some((r: any) => r.id === recId)).toBe(true);
  });

  it('a correction needs a reason, sane times and no overlap', async () => {
    await owner.patch(`${A}/${recId}`).send({ note: 'x' }).expect(400); // no reason
    await owner.patch(`${A}/${recId}`).send({ reason: 'why' }).expect(400); // nothing to change
    const rec = await prisma.attendance.findUniqueOrThrow({
      where: { id: recId },
    });
    const before = (d: Date, ms: number) =>
      new Date(d.getTime() + ms).toISOString();
    expect(
      (
        await owner
          .patch(`${A}/${recId}`)
          .send({ clockOutAt: before(rec.clockInAt, -1000), reason: 'bad' })
      ).body.message,
    ).toMatch(/after clock-in/);
    expect(
      (
        await owner.patch(`${A}/${recId}`).send({
          clockOutAt: new Date(Date.now() + 3_600_000).toISOString(),
          reason: 'future',
        })
      ).body.message,
    ).toMatch(/future/);
    expect(
      (
        await owner.patch(`${A}/${recId}`).send({
          clockInAt: before(rec.clockInAt, -26 * 3_600_000),
          reason: 'long',
        })
      ).body.message,
    ).toMatch(/24 hours/);
    // Overlap: two shifts yesterday, then try to stretch the first onto the second.
    const day = new Date(Date.now() - 36 * 3_600_000);
    day.setUTCMinutes(0, 0, 0);
    const at = (h: number) => new Date(day.getTime() + h * 3_600_000);
    const first = await prisma.attendance.create({
      data: {
        branchId: BRANCH,
        userId: waiterId,
        clockInAt: at(0),
        clockOutAt: at(2),
      },
    });
    const second = await prisma.attendance.create({
      data: {
        branchId: BRANCH,
        userId: waiterId,
        clockInAt: at(4),
        clockOutAt: at(6),
      },
    });
    const ov = await owner
      .patch(`${A}/${first.id}`)
      .send({ clockOutAt: at(5).toISOString(), reason: 'overlap' });
    expect(ov.status).toBe(400);
    expect(ov.body.message).toMatch(/overlaps/);
    // Stretching within the gap is fine.
    const fits = await owner
      .patch(`${A}/${first.id}`)
      .send({ clockOutAt: at(3).toISOString(), reason: 'fits the gap' });
    expect(fits.body.message ?? fits.status).toBe(200);
    await prisma.attendance.deleteMany({
      where: { id: { in: [first.id, second.id] } },
    });
  });

  it('a valid correction is applied and audited with before and after', async () => {
    const rec = await prisma.attendance.findUniqueOrThrow({
      where: { id: recId },
    });
    const newOut = new Date(rec.clockInAt.getTime() + 8 * 3_600_000);
    // Only valid if that is not in the future; the shift started "now", so shift it back.
    const start = new Date(Date.now() - 10 * 3_600_000);
    const res = await owner
      .patch(`${A}/${recId}`)
      .send({
        clockInAt: start.toISOString(),
        clockOutAt: new Date(start.getTime() + 8 * 3_600_000).toISOString(),
        reason: 'Forgot to clock out',
      })
      .expect(200);
    expect(
      new Date(res.body.clockOutAt).getTime() -
        new Date(res.body.clockInAt).getTime(),
    ).toBe(8 * 3_600_000);
    void newOut;
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'attendance.corrected', entityId: recId },
      orderBy: { createdAt: 'desc' },
    });
    const meta = audit.metadata as any;
    expect(meta.reason).toBe('Forgot to clock out');
    expect(meta.before.clockInAt).toBeDefined();
    expect(meta.after.clockOutAt).toBeDefined();
    expect(meta.before.clockInAt).not.toBe(meta.after.clockInAt);
  });

  it('another restaurant cannot see or correct it', async () => {
    await other
      .patch(`${A}/${recId}`)
      .send({ note: 'hijack', reason: 'nope' })
      .expect(404);
    const otherBranch = (await other.get('/api/v1/branches').expect(200))
      .body[0].id;
    expect(
      (await other.get(`${A}?branchId=${otherBranch}`).expect(200)).body,
    ).toEqual([]);
    await other.get(`${A}${q}`).expect(403);
  });

  it('cannot be changed once a payroll run covering it is finalized', async () => {
    const year = 1900 + (parseInt(tag.slice(0, 3), 16) % 90);
    const rec = await prisma.attendance.create({
      data: {
        branchId: BRANCH,
        userId: waiterId,
        clockInAt: new Date(`${year}-03-10T04:00:00Z`),
        clockOutAt: new Date(`${year}-03-10T12:00:00Z`),
      },
    });
    await prisma.payrollRun.create({
      data: {
        branchId: BRANCH,
        periodStart: new Date(`${year}-03-01`),
        periodEnd: new Date(`${year}-03-31`),
        status: 'FINALIZED',
      },
    });
    const r = await owner.patch(`${A}/${rec.id}`).send({
      clockOutAt: new Date(`${year}-03-10T13:00:00Z`).toISOString(),
      reason: 'late edit',
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/finalized/);
    const same = await prisma.attendance.findUniqueOrThrow({
      where: { id: rec.id },
    });
    expect(same.clockOutAt?.toISOString()).toBe(`${year}-03-10T12:00:00.000Z`);
  });
});
