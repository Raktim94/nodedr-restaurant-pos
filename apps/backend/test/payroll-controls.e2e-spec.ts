/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped by design */
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
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    owner = request.agent(app.getHttpServer());
    await owner.post('/api/v1/auth/login').send({ email: 'owner@demo.local', password: 'Password123!' }).expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as { id: string; name: string }[];
    const mk = async (name: string, role: string) => {
      const email = `${name}-${tag}@demo.local`;
      const r = await owner.post('/api/v1/users').send({ name: `${name} ${tag}`, email, password: 'Password123!', roleId: roles.find((x) => x.name === role)!.id, branchIds: [BRANCH] }).expect(201);
      return { id: r.body.id as string, email };
    };
    cook = (await mk('cook', 'CHEF')).id;
    const m = await mk('mgr', 'RESTAURANT_MANAGER');
    managerId = m.id;
    manager = request.agent(app.getHttpServer());
    await manager.post('/api/v1/auth/login').send({ email: m.email, password: 'Password123!' }).expect(201);
    await owner.put(api(`/pay/${cook}`)).send({ payType: 'HOURLY', rate: 100 }).expect(200);
    await owner.put(api(`/pay/${managerId}`)).send({ payType: 'HOURLY', rate: 100 }).expect(200);
    const d = (day: string, a: string, b: string | null) =>
      prisma.attendance.create({ data: { branchId: BRANCH, userId: cook, clockInAt: new Date(`${year}-03-${day}T${a}:00Z`), clockOutAt: b ? new Date(`${year}-03-${day}T${b}:00Z`) : null } });
    await d('05', '04:00', '12:00'); // 8 h
    await d('05', '04:00', '12:00'); // the same shift saved twice
    await d('06', '04:00', '08:00'); // 4 h
    await d('07', '04:00', null); // forgot to clock out
  });
  afterAll(async () => {
    await prisma.attendance.deleteMany({ where: { userId: { in: [cook, managerId] } } });
    if (runId) await prisma.payrollRun.deleteMany({ where: { id: runId, status: 'DRAFT' } });
    await app.close();
  });

  it('pays duplicate attendance once, and warns about the shift that was never closed', async () => {
    const res = await owner.post(api('/payroll')).send({ periodStart: start, periodEnd: end }).expect(201);
    runId = res.body.id;
    const line = res.body.lines.find((l: { userId: string }) => l.userId === cook);
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
    await owner.patch(api(`/payroll/${runId}/lines/${cook}`)).send({ allowances: 0, bonus: 50, advanceRecovery: 0, otherDeductions: 0, adjustmentNote: 'Festival bonus' }).expect(200);
    await owner.post(api(`/payroll/${runId}/finalize`)).expect(201);
    expect((await manager.post(api(`/payroll/${runId}/pay`)).send({ method: 'CASH' })).status).toBe(403);
    await owner.post(api(`/payroll/${runId}/pay`)).send({ method: 'CASH' }).expect(201);
    const again = await owner.post(api(`/payroll/${runId}/reopen`));
    expect(again.status).toBe(400);
    expect((await owner.post(api(`/payroll/${runId}/pay`)).send({ method: 'CASH' })).status).toBe(400);
  });

  it('exports the run as CSV with the figures that were paid', async () => {
    const csv = await owner.get(api(`/payroll/${runId}/export.csv`)).expect(200);
    expect(csv.text).toContain('Employee,Period,Status,Hours');
    expect(csv.text).toContain('1250'); // 1200 + 50 bonus
    expect(csv.text).toContain('Festival bonus');
  });
});
