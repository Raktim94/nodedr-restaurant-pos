/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Payroll controls: duplicate attendance, open shifts, own-payroll approval, reopen, CSV.
//   PAYROLL_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand payroll-controls
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.PAYROLL_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);
const year = 1800 + (parseInt(tag.slice(0, 3), 16) % 90);
const start = `${year}-03-01`;
const end = `${year}-03-31`;

run('Payroll controls (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let manager: ReturnType<typeof request.agent>;
  let cook: string;
  let managerId: string;
  let runId: string;
  const api = (p: string) => `/api/v1/hr${p}${q}`;

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
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const mk = async (name: string, role: string) => {
      const email = `${name}-${tag}@demo.local`;
      const r = await owner
        .post('/api/v1/users')
        .send({
          name: `${name} ${tag}`,
          email,
          password: 'Password123!',
          roleId: roles.find((x) => x.name === role)!.id,
          branchIds: [BRANCH],
        })
        .expect(201);
      return { id: r.body.id as string, email };
    };
    cook = (await mk('cook', 'CHEF')).id;
    const m = await mk('mgr', 'RESTAURANT_MANAGER');
    managerId = m.id;
    manager = request.agent(app.getHttpServer());
    await manager
      .post('/api/v1/auth/login')
      .send({ email: m.email, password: 'Password123!' })
      .expect(201);
    await owner
      .put(api(`/pay/${cook}`))
      .send({ payType: 'HOURLY', rate: 100 })
      .expect(200);
    await owner
      .put(api(`/pay/${managerId}`))
      .send({ payType: 'HOURLY', rate: 100 })
      .expect(200);
    const d = (day: string, a: string, b: string | null) =>
      prisma.attendance.create({
        data: {
          branchId: BRANCH,
          userId: cook,
          clockInAt: new Date(`${year}-03-${day}T${a}:00Z`),
          clockOutAt: b ? new Date(`${year}-03-${day}T${b}:00Z`) : null,
        },
      });
    await d('05', '04:00', '12:00'); // 8 h
    await d('05', '04:00', '12:00'); // the same shift saved twice
    await d('06', '04:00', '08:00'); // 4 h
    await d('07', '04:00', null); // forgot to clock out
  });
  afterAll(async () => {
    await prisma.attendance.deleteMany({
      where: { userId: { in: [cook, managerId] } },
    });
    if (runId)
      await prisma.payrollRun.deleteMany({
        where: { id: runId, status: 'DRAFT' },
      });
    await app.close();
  });

  it('pays duplicate attendance once, and warns about the shift that was never closed', async () => {
    const res = await owner
      .post(api('/payroll'))
      .send({ periodStart: start, periodEnd: end })
      .expect(201);
    runId = res.body.id;
    const line = res.body.lines.find(
      (l: { userId: string }) => l.userId === cook,
    );
    expect(Number(line.hoursWorked)).toBe(12); // 8 + 4, not 20
    expect(Number(line.basePay)).toBe(1200);
    const text = JSON.stringify(res.body.warnings);
    expect(text).toMatch(/overlapping/);
    expect(text).toMatch(/no clock-out/);
  });

  it('someone paid on the run cannot approve it, unless they can manage roles', async () => {
    const r = await manager.post(api(`/payroll/${runId}/finalize`));
    expect(r.status).toBe(403);
    await owner.post(api(`/payroll/${runId}/finalize`)).expect(201);
  });

  it('a finalized run can be reopened, corrected and finalized again; a paid one cannot', async () => {
    await owner.post(api(`/payroll/${runId}/reopen`)).expect(201);
    await owner
      .patch(api(`/payroll/${runId}/lines/${cook}`))
      .send({
        allowances: 0,
        bonus: 50,
        advanceRecovery: 0,
        otherDeductions: 0,
        adjustmentNote: 'Festival bonus',
      })
      .expect(200);
    await owner.post(api(`/payroll/${runId}/finalize`)).expect(201);
    expect(
      (
        await manager
          .post(api(`/payroll/${runId}/pay`))
          .send({ method: 'CASH' })
      ).status,
    ).toBe(403);
    await owner
      .post(api(`/payroll/${runId}/pay`))
      .send({ method: 'CASH' })
      .expect(201);
    const again = await owner.post(api(`/payroll/${runId}/reopen`));
    expect(again.status).toBe(400);
    expect(
      (await owner.post(api(`/payroll/${runId}/pay`)).send({ method: 'CASH' }))
        .status,
    ).toBe(400);
  });

  it('exports the run as CSV with the figures that were paid', async () => {
    const csv = await owner
      .get(api(`/payroll/${runId}/export.csv`))
      .expect(200);
    expect(csv.text).toContain('Employee,Period,Status,Hours');
    expect(csv.text).toContain('1250'); // 1200 + 50 bonus
    expect(csv.text).toContain('Festival bonus');
  });
});

run('Payroll late and absence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let staff: string;
  let runId: string;
  const y = 1700 + (parseInt(tag.slice(0, 3), 16) % 90);
  const api = (p: string) => `/api/v1/hr${p}${q}`;

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
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `rota-${tag}@demo.local`;
    staff = (
      await owner
        .post('/api/v1/users')
        .send({
          name: `Rota ${tag}`,
          email,
          password: 'Password123!',
          roleId: roles.find((r) => r.name === 'WAITER')!.id,
          branchIds: [BRANCH],
        })
        .expect(201)
    ).body.id;
    await owner
      .put(api(`/pay/${staff}`))
      .send({
        payType: 'MONTHLY',
        rate: 31000,
        lateGraceMinutes: 10,
        deductAbsence: true,
      })
      .expect(200);
    const shift = (d: string) =>
      prisma.shift.create({
        data: {
          branchId: BRANCH,
          userId: staff,
          startsAt: new Date(`${y}-03-${d}T09:00:00Z`),
          endsAt: new Date(`${y}-03-${d}T17:00:00Z`),
        },
      });
    await shift('03');
    await shift('04');
    await shift('05');
    const clock = (d: string, a: string) =>
      prisma.attendance.create({
        data: {
          branchId: BRANCH,
          userId: staff,
          clockInAt: new Date(`${y}-03-${d}T${a}:00Z`),
          clockOutAt: new Date(`${y}-03-${d}T17:00:00Z`),
        },
      });
    await clock('03', '09:05'); // inside grace
    await clock('04', '09:48'); // 48 min late of 480
    // the 5th: rostered, never came, no leave -> absent
  });
  afterAll(async () => {
    await prisma.attendance.deleteMany({ where: { userId: staff } });
    await prisma.shift.deleteMany({ where: { userId: staff } });
    if (runId)
      await prisma.payrollRun.deleteMany({
        where: { id: runId, status: 'DRAFT' },
      });
    await app.close();
  });

  it('deducts lateness beyond the grace and an absent rostered day, and shows why', async () => {
    const res = await owner
      .post(api('/payroll'))
      .send({ periodStart: `${y}-03-01`, periodEnd: `${y}-03-31` })
      .expect(201);
    runId = res.body.id;
    const line = res.body.lines.find(
      (l: { userId: string }) => l.userId === staff,
    );
    expect(line.lateMinutes).toBe(48);
    expect(Number(line.lateDeduction)).toBe(100); // 1000 a day x 48/480
    expect(line.absentDays).toBe(1);
    expect(Number(line.absenceDeduction)).toBe(1000);
    expect(Number(line.netPay)).toBe(31000 - 100 - 1000);
    expect(JSON.stringify(line.calcInputs.formula)).toMatch(/absent/);
    const slip = (
      await owner.get(api(`/payroll/${runId}/lines/${staff}/slip`)).expect(200)
    ).body;
    expect(slip.deductions.late).toBe(100);
    expect(slip.deductions.absence).toBe(1000);
  });

  it('an adjustment on the draft keeps those deductions in the net', async () => {
    const r = await owner
      .patch(api(`/payroll/${runId}/lines/${staff}`))
      .send({ bonus: 500 })
      .expect(200);
    expect(Number(r.body.netPay)).toBe(31000 - 1100 + 500);
  });
});
