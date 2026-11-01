/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
// Payroll: attendance -> run -> adjustments -> finalize -> pay once, plus the
// duplicate-run race, permissions and tenant isolation.
//   PAYROLL_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand payroll
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.PAYROLL_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
// These suites create a second restaurant, which needs sign-up opened (it is closed by default).
process.env.ALLOW_PUBLIC_SIGNUP = 'true';
const tag = randomUUID().slice(0, 6);
// A distinct far-past year per test run so periods never collide with real data.
const year = 1900 + (parseInt(tag.slice(0, 3), 16) % 90);
const start = `${year}-01-10`;
const end = `${year}-01-20`;

run('Payroll (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let staffId: string;
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
    const mkUser = async (name: string, role: string) => {
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
      return { id: res.body.id as string, email };
    };
    const staff = await mkUser('waiter', 'WAITER');
    staffId = staff.id;
    const c = await mkUser('cashier', 'CASHIER');
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email: c.email, password: 'Password123!' })
      .expect(201);

    await owner
      .put(api(`/pay/${staffId}`))
      .send({ payType: 'HOURLY', rate: 200 })
      .expect(200);
    // Two 8-hour shifts inside the period (mid-day UTC so any branch timezone agrees).
    for (const day of ['14', '15']) {
      await prisma.attendance.create({
        data: {
          branchId: BRANCH,
          userId: staffId,
          clockInAt: new Date(`${year}-01-${day}T04:00:00Z`),
          clockOutAt: new Date(`${year}-01-${day}T12:00:00Z`),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({
      where: { branchId: BRANCH, periodStart: { lt: new Date('2000-01-01') } },
    });
    await prisma.attendance.deleteMany({ where: { userId: staffId } });
    await app.close();
  });

  it('two simultaneous requests for the same period create exactly one run', async () => {
    const [a, b] = await Promise.all([
      owner.post(api('/payroll')).send({ periodStart: start, periodEnd: end }),
      owner.post(api('/payroll')).send({ periodStart: start, periodEnd: end }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const ok = a.status === 201 ? a : b;
    runId = ok.body.id;
    const count = await prisma.payrollRun.count({
      where: { branchId: BRANCH, periodStart: new Date(`${start}T00:00:00Z`) },
    });
    expect(count).toBe(1);
  });

  it('computes hourly pay from attendance: 16h x 200 = 3200', async () => {
    const res = await owner.get(api(`/payroll/${runId}`)).expect(200);
    const line = res.body.lines.find((l: any) => l.userId === staffId);
    expect(Number(line.hoursWorked)).toBe(16);
    expect(Number(line.basePay)).toBe(3200);
    expect(Number(line.netPay)).toBe(3200);
  });

  it('applies adjustments exactly and keeps the run total in step', async () => {
    const res = await owner
      .patch(api(`/payroll/${runId}/lines/${staffId}`))
      .send({
        allowances: 500,
        bonus: 250,
        advanceRecovery: 300,
        otherDeductions: 50,
        adjustmentNote: 'Festival bonus, March advance',
      })
      .expect(200);
    expect(Number(res.body.netPay)).toBe(3600);
    const run = await owner.get(api(`/payroll/${runId}`)).expect(200);
    const sum = run.body.lines.reduce(
      (s: number, l: any) => s + Number(l.netPay),
      0,
    );
    expect(Number(run.body.totalNet)).toBeCloseTo(sum, 2);
  });

  it('refuses deductions larger than the pay, and bad input', async () => {
    const big = await owner
      .patch(api(`/payroll/${runId}/lines/${staffId}`))
      .send({ advanceRecovery: 99999 });
    expect(big.status).toBe(400);
    expect(big.body.message).toMatch(/more than the pay/);
    await owner
      .patch(api(`/payroll/${runId}/lines/${staffId}`))
      .send({ bonus: -5 })
      .expect(400);
    await owner
      .patch(api(`/payroll/${runId}/lines/${staffId}`))
      .send({})
      .expect(400);
    // The failed attempts changed nothing.
    const line = await prisma.payrollLine.findFirstOrThrow({
      where: { runId, userId: staffId },
    });
    expect(Number(line.netPay)).toBe(3600);
  });

  it('cannot be paid before it is finalized', async () => {
    const res = await owner
      .post(api(`/payroll/${runId}/pay`))
      .send({ method: 'BANK_TRANSFER' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Finalize/);
  });

  it('finalizing locks adjustments, then pays exactly once', async () => {
    await owner.post(api(`/payroll/${runId}/finalize`)).expect(201);
    const locked = await owner
      .patch(api(`/payroll/${runId}/lines/${staffId}`))
      .send({ bonus: 1 });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toMatch(/draft/i);

    // Two admins click Pay at the same moment: one wins.
    const [a, b] = await Promise.all([
      owner
        .post(api(`/payroll/${runId}/pay`))
        .send({ method: 'BANK_TRANSFER', reference: 'NEFT123' }),
      owner
        .post(api(`/payroll/${runId}/pay`))
        .send({ method: 'BANK_TRANSFER', reference: 'NEFT123' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const row = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(row.status).toBe('PAID');
    expect(row.paymentMethod).toBe('BANK_TRANSFER');
    expect(row.paymentRef).toBe('NEFT123');
    expect(row.paidAt).not.toBeNull();
    expect(row.paidById).not.toBeNull();
    const again = await owner
      .post(api(`/payroll/${runId}/pay`))
      .send({ method: 'CASH' });
    expect(again.body.message).toMatch(/already paid/);
  });

  it('a paid run cannot be deleted', async () => {
    await owner.delete(api(`/payroll/${runId}`)).expect(400);
  });

  it('produces a salary slip with every figure', async () => {
    const slip = (
      await owner
        .get(api(`/payroll/${runId}/lines/${staffId}/slip`))
        .expect(200)
    ).body;
    expect(slip.employee).toContain('waiter');
    expect(slip.earnings).toEqual({
      basePay: 3200,
      tipShare: 0,
      allowances: 500,
      bonus: 250,
    });
    expect(slip.deductions).toEqual({
      unpaidLeave: 0,
      advanceRecovery: 300,
      other: 50,
    });
    expect(slip.netPay).toBe(3600);
    expect(slip.status).toBe('PAID');
    expect(slip.note).toBe('Festival bonus, March advance');
  });

  it('the adjustments were audited', async () => {
    const n = await prisma.auditLog.count({
      where: {
        action: {
          in: [
            'payroll.line_adjusted',
            'payroll.paid',
            'payroll.finalized',
            'payroll.created',
          ],
        },
        entityId: runId,
      },
    });
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('is closed to a cashier and to another restaurant', async () => {
    await cashier.get(api(`/payroll/${runId}`)).expect(403);
    await cashier
      .get(api(`/payroll/${runId}/lines/${staffId}/slip`))
      .expect(403);
    await cashier
      .post(api(`/payroll/${runId}/pay`))
      .send({ method: 'CASH' })
      .expect(403);

    const email = `pay-other-${tag}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ownerName: 'Other',
        email,
        password: 'Password123!',
        restaurantName: `Other ${tag}`,
        branchName: 'Main',
      })
      .expect(201);
    const other = request.agent(app.getHttpServer());
    await other
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    await other.get(api(`/payroll/${runId}`)).expect(403);
    await other.get(api(`/payroll/${runId}/lines/${staffId}/slip`)).expect(403);
  });
});
