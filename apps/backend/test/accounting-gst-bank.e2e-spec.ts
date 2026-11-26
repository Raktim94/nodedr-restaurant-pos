/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped by design */
// Accounting against a REAL Postgres: the GST report must reconcile to the tax
// stored on the bills (loyalty redemption is tender, not a price cut), and bank
// matching must refuse money-in lines and never let one expense back two lines.
//   LEDGER_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand accounting-gst-bank
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { BranchTimeService } from './../src/common/services/branch-time.service';
import { localDate } from './../src/common/time';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.LEDGER_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
// February 1 in the seeded restaurant (Asia/Kolkata), January 31 in UTC.
const GST_BILLED_AT = new Date('2026-01-31T19:15:00Z');
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('GST report and bank matching (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let ownerId: string;
  let floorId: string;
  let categoryId: string;
  let gstDay: string;
  let seq = 0;

  const post = (p: string, b?: object) => owner.post(`/api/v1${p}`).send(b);
  const money = (n: number) => Math.round(n * 100) / 100;

  /** Pays a one-line bill; returns the order as stored. */
  const paidBill = async (
    price: number,
    taxRatePercent: number,
    discountFlat = 0,
  ) => {
    const item = (
      await post(`/menu/items${q}`, {
        categoryId,
        name: `GST dish ${tag}-${++seq}`,
        price,
        taxRatePercent,
      }).expect(201)
    ).body.id;
    const t = await post(`/tables${q}`, {
      floorId,
      number: `T${seq}-${tag}`,
      capacity: 2,
    }).expect(201);
    const o = await post(`/orders${q}`, {
      type: 'DINE_IN',
      tableId: t.body.id,
      items: [{ menuItemId: item, quantity: 1, modifierIds: [] }],
    }).expect(201);
    await post(`/orders/${o.body.id}/checkout${q}`, {
      requestId: randomUUID(),
      ...(discountFlat ? { discountFlat } : {}),
      payments: [{ method: 'CASH', amount: price - discountFlat }],
    }).expect(201);
    // Checkout must set billedAt. Pin that timestamp for the report snapshots.
    return prisma.order.update({
      where: { id: o.body.id, billedAt: { not: null } },
      data: { billedAt: GST_BILLED_AT },
    });
  };
  const gst = async () =>
    (
      await owner
        .get(`/api/v1/accounting/gst${q}&from=${gstDay}&to=${gstDay}`)
        .expect(200)
    ).body;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: [] });
    await app.init();
    prisma = app.get(PrismaService);
    const timezone = await app.get(BranchTimeService).tzForBranch(BRANCH);
    gstDay = localDate(GST_BILLED_AT, timezone);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    ownerId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'owner@demo.local' },
      })
    ).id;
    floorId = (await owner.get(`/api/v1/tables/floors${q}`).expect(200)).body[0]
      .id;
    categoryId = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GST total reconciles to the tax stored on the bills (multiple rates, discount)', async () => {
    const before = await gst();
    const a = await paidBill(118, 18);
    const b = await paidBill(105, 5, 10); // flat discount reduces taxable value
    const c = await paidBill(100, 0);
    const after = await gst();
    const storedTax = [a, b, c].reduce((s, o) => s + Number(o.taxAmount), 0);
    // Every bill is rounded on its own: report tax moves by the stored tax,
    // within a rupee-cent of per-line rounding.
    expect(
      Math.abs(money(after.totalTax - before.totalTax) - money(storedTax)),
    ).toBeLessThanOrEqual(0.02);
    expect(after.orders - before.orders).toBe(3);
  });

  it('a loyalty redemption does not reduce the taxable value in the report', async () => {
    const before = await gst();
    const o = await paidBill(118, 18);
    // Record a loyalty redemption on the stored bill the way checkout does:
    // it lowers what was charged but not the tax breakup.
    await prisma.order.update({
      where: { id: o.id },
      data: {
        loyaltyDiscountAmount: 20,
        totalAmount: Number(o.totalAmount) - 20,
      },
    });
    const after = await gst();
    expect(
      Math.abs(money(after.totalTax - before.totalTax) - Number(o.taxAmount)),
    ).toBeLessThanOrEqual(0.01);
  });

  describe('bank matching', () => {
    const bankLine = (amount: number, label: string) =>
      prisma.bankTransaction.create({
        data: {
          branchId: BRANCH,
          postedOn: new Date(),
          description: `${label} ${tag} ${++seq}`,
          amount,
          reference: randomUUID(),
        },
      });
    const expense = (amount: number) =>
      prisma.expense.create({
        data: {
          branchId: BRANCH,
          spentOn: new Date(),
          category: 'Supplies',
          amount,
          createdById: ownerId,
        },
      });
    const match = (id: string, expenseId: string) =>
      post(`/accounting/bank/${id}/match${q}`, { expenseId });

    it('refuses to match money-in, zero and offers no candidates for them', async () => {
      const e = await expense(500);
      for (const amount of [500, 0]) {
        const t = await bankLine(amount, 'in');
        expect((await match(t.id, e.id)).status).toBe(400);
        const cands = await owner
          .get(`/api/v1/accounting/bank/${t.id}/candidates${q}`)
          .expect(200);
        expect(cands.body).toEqual([]);
      }
    });

    it('matches a money-out line, and the same expense cannot back a second line', async () => {
      const e = await expense(321);
      const t1 = await bankLine(-321, 'out');
      const t2 = await bankLine(-321, 'out');
      await match(t1.id, e.id).expect(201);
      expect((await match(t2.id, e.id)).status).toBe(400);
    });

    it('two simultaneous matches of one expense: exactly one wins', async () => {
      const e = await expense(77);
      const lines = await Promise.all(
        Array.from({ length: 4 }, () => bankLine(-77, 'race')),
      );
      const rs = await Promise.all(lines.map((t) => match(t.id, e.id)));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        await prisma.bankTransaction.count({
          where: { branchId: BRANCH, expenseId: e.id },
        }),
      ).toBe(1);
    });

    it('auto-match racing manual matches never double-books an expense', async () => {
      const e = await expense(63.5);
      const t = await bankLine(-63.5, 'auto');
      const other = await bankLine(-63.5, 'auto2');
      const [, m] = await Promise.all([
        post(`/accounting/bank/auto-match${q}`),
        match(other.id, e.id),
      ]);
      expect([201, 400]).toContain(m.status);
      expect(
        await prisma.bankTransaction.count({
          where: { branchId: BRANCH, expenseId: e.id },
        }),
      ).toBeLessThanOrEqual(1);
      expect(t.id).toBeTruthy();
    });
  });
});
