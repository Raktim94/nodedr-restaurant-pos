/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped by design */
// Referral rewards: attribution, one-time payout after the first PAID purchase, point value, safety.
//   REFERRALS_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand referrals
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { ReferralsService } from './../src/modules/referrals/referrals.service';

const run = process.env.REFERRALS_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const API = '/api/v1/integrations';
const tag = String(Date.now()).slice(-6);
// Distinct numbers so reruns never collide with earlier customers.
const phone = (n: number) => `+91 98${tag}${n}0`.replace(/\s/g, ' ');

run('Referral rewards (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let referralsSvc: ReferralsService;
  let owner: ReturnType<typeof request.agent>;
  let token: string;
  let restaurantId: string;
  let original: Record<string, unknown>;

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const rewards = (p: string, name = 'Cust') =>
    http()
      .post(`${API}/locations/${BRANCH}/rewards`)
      .set(auth())
      .send({ customerPhone: p, customerName: name });
  const place = (
    p: string,
    over: Record<string, unknown> = {},
    idem?: string,
  ) =>
    http()
      .post(`${API}/locations/${BRANCH}/orders`)
      .set(auth())
      .set(idem ? { 'Idempotency-Key': idem } : {})
      .send({
        type: 'DELIVERY',
        customerName: `Cust ${p.slice(-4)}`,
        customerPhone: p,
        delivery: { address: '12 MG Road, Flat 4B', pincode: '700001' },
        items: [{ menuItemId: 'demo-item-cola', quantity: 3 }],
        ...over,
      });
  const points = async (p: string) =>
    (
      await prisma.customer.findFirstOrThrow({
        where: { branchId: BRANCH, phone: p },
      })
    ).loyaltyPoints;
  const accept = (id: string) =>
    owner.post(`/api/v1/orders/${id}/accept${q}`).expect(201);
  const preview = async (id: string, body: object = {}) =>
    (
      await owner
        .post(`/api/v1/orders/${id}/bill-preview${q}`)
        .send(body)
        .expect(201)
    ).body;
  const payInFull = async (id: string, requestId?: string) => {
    const v = await preview(id);
    return owner.post(`/api/v1/orders/${id}/checkout${q}`).send({
      payments: [{ method: 'CASH', amount: Number(v.totalDue) }],
      requestId,
    });
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    referralsSvc = app.get(ReferralsService);
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    restaurantId = (
      await prisma.branch.findUniqueOrThrow({ where: { id: BRANCH } })
    ).restaurantId;
    original = await prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });
    await prisma.branch.update({
      where: { id: BRANCH },
      data: { autoConfirmOrders: false },
    });
    const key = await owner
      .post('/api/v1/integration-api-keys')
      .send({
        name: `ref-${tag}`,
        scopes: ['orders:write', 'orders:read', 'menu:read', 'locations:read'],
      })
      .expect(201);
    token = key.body.token;
  });

  afterAll(async () => {
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        referralEnabled: original.referralEnabled as boolean,
        referralSharerPoints: original.referralSharerPoints as number,
        referralReferredPoints: original.referralReferredPoints as number,
        loyaltyPointValue: original.loyaltyPointValue as never,
        loyaltyEarnPerCurrency: original.loyaltyEarnPerCurrency as number,
        referralMinPurchase: original.referralMinPurchase as never,
        onlineMinOrderAmount: original.onlineMinOrderAmount as never,
      },
    });
    await prisma.integrationApiKey.deleteMany({
      where: { name: { endsWith: `-${tag}` } },
    });
    await app.close();
  });

  const settings = (body: object) =>
    owner.patch('/api/v1/settings/restaurant').send(body).expect(200);

  it('is off by default: no code is issued and a referral is not recorded', async () => {
    await settings({
      referralEnabled: false,
      referralSharerPoints: 15,
      referralReferredPoints: 10,
      loyaltyPointValue: 0.1,
      loyaltyEarnPerCurrency: 100000,
      referralMinPurchase: 200,
      onlineMinOrderAmount: 0,
    });
    const r = await rewards(phone(1)).expect(201);
    expect(r.body.referralEnabled).toBe(false);
    expect(r.body.code).toBeNull();
    expect(r.body.pointValue).toBe(0.1);
  });

  it('admin settings are validated and saved (15 / 10 points, 100 points = 10)', async () => {
    await owner
      .patch('/api/v1/settings/restaurant')
      .send({ referralSharerPoints: -1 })
      .expect(400);
    await settings({ referralEnabled: true });
    const r = await rewards(phone(1)).expect(201);
    expect(r.body.referralEnabled).toBe(true);
    expect(r.body.sharerPoints).toBe(15);
    expect(r.body.referredPoints).toBe(10);
    expect(r.body.code).toMatch(/^[A-Z2-9]{7}$/);
    // the same customer keeps the same code
    const again = await rewards(phone(1)).expect(201);
    expect(again.body.code).toBe(r.body.code);
  });

  let code: string;
  let referredOrder: string;

  it('attributes a new customer to the sharer but pays nothing yet', async () => {
    code = (await rewards(phone(1))).body.code;
    const res = await place(phone(2), {
      referralCode: code,
      sharedItemId: 'demo-item-cola',
    }).expect(201);
    expect(res.body.rewards.referral).toEqual({ applied: true });
    referredOrder = res.body.id;
    const ref = await prisma.referral.findFirstOrThrow({
      where: { referred: { phone: phone(2) } },
    });
    expect(ref.status).toBe('PENDING');
    expect(ref.sharedItemId).toBe('demo-item-cola');
    expect(await points(phone(1))).toBe(0);
    expect(await points(phone(2))).toBe(0);
  });

  it('still pays nothing after acceptance, until the purchase is actually paid', async () => {
    await accept(referredOrder);
    expect(await points(phone(1))).toBe(0);
    expect(await points(phone(2))).toBe(0);
  });

  it('pays 10 to the new customer and 15 to the sharer when the first purchase is paid, exactly once', async () => {
    const requestId = randomUUID();
    expect((await payInFull(referredOrder, requestId)).status).toBe(201);
    expect(await points(phone(2))).toBe(10);
    expect(await points(phone(1))).toBe(15);

    // A retried checkout and a direct replay of the payout change nothing.
    await payInFull(referredOrder, requestId);
    await prisma.$transaction((tx) =>
      referralsSvc.onOrderPaid(tx, {
        id: referredOrder,
        branchId: BRANCH,
        customerId: null,
        totalAmount: 100,
        foodValue: 300,
      }),
    );
    const ref = await prisma.referral.findFirstOrThrow({
      where: { referred: { phone: phone(2) } },
    });
    expect(ref.status).toBe('REWARDED');
    expect(ref.qualifyingOrderId).toBe(referredOrder);
    await prisma.$transaction((tx) =>
      referralsSvc.onOrderPaid(tx, {
        id: referredOrder,
        branchId: BRANCH,
        customerId: ref.referredId,
        totalAmount: 100,
        foodValue: 300,
      }),
    );
    expect(await points(phone(2))).toBe(10);
    expect(await points(phone(1))).toBe(15);
    const ledger = await prisma.pointsLedger.findMany({
      where: { referralId: ref.id },
    });
    expect(ledger.map((l) => l.reason).sort()).toEqual([
      'REFERRAL_REFERRED',
      'REFERRAL_REFERRER',
    ]);
  });

  it('a second purchase by the referred customer earns the sharer nothing more', async () => {
    const o = await place(phone(2)).expect(201);
    await accept(o.body.id);
    expect((await payInFull(o.body.id)).status).toBe(201);
    expect(await points(phone(1))).toBe(15);
    expect(await points(phone(2))).toBe(10);
  });

  it('refuses self-referral, even with a different phone format', async () => {
    const own = await place(phone(1), { referralCode: code }).expect(201);
    expect(own.body.rewards.referral.applied).toBe(false);
    expect(own.body.rewards.referral.reason).toMatch(/own/i);
    const fmt = phone(1).replace('+91 ', '0');
    const alt = await place(fmt, { referralCode: code }).expect(201);
    expect(alt.body.rewards.referral.applied).toBe(false);
    expect(
      await prisma.referral.count({
        where: { referrer: { phone: phone(1) }, referred: { phone: phone(1) } },
      }),
    ).toBe(0);
  });

  it('a customer can be referred only once, and only if new', async () => {
    const other = (await rewards(phone(3))).body.code;
    const again = await place(phone(2), { referralCode: other }).expect(201);
    expect(again.body.rewards.referral.applied).toBe(false);
    // phone(2) already has paid orders: not a new customer for a different sharer either
    const fresh = await place(phone(4)).expect(201);
    await accept(fresh.body.id);
    expect((await payInFull(fresh.body.id)).status).toBe(201);
    const late = await place(phone(4), { referralCode: other }).expect(201);
    expect(late.body.rewards.referral.applied).toBe(false);
    expect(late.body.rewards.referral.reason).toMatch(/new customers|already/i);
  });

  it('ignores unknown or malformed codes without failing the order', async () => {
    const bad = await place(phone(5), { referralCode: 'ZZZZZZZ' }).expect(201);
    expect(bad.body.rewards.referral.applied).toBe(false);
    await place(phone(6), { referralCode: 'x' }).expect(400);
  });

  it('a retried order request with the same Idempotency-Key does not double-attribute', async () => {
    const key = `idem-${tag}-aaaa`;
    const a = await place(phone(7), { referralCode: code }, key).expect(201);
    const b = await place(phone(7), { referralCode: code }, key).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(
      await prisma.referral.count({ where: { referred: { phone: phone(7) } } }),
    ).toBe(1);
  });

  it('shows balance, rewards and value; redeems points at the configured value', async () => {
    // phone(1) has 15 points at 0.10 each.
    const r = (await rewards(phone(1))).body;
    expect(r.points).toBe(15);
    expect(r.balanceValue).toBe(1.5);
    expect(r.rewards).toEqual([{ points: 15, discount: 1.5 }]);
    expect(r.referredBy).toBeNull();

    const o = await place(phone(1), { redeemPoints: 1000 }).expect(201);
    expect(o.body.rewards.redeem).toEqual({ points: 15, discount: 1.5 });
    await accept(o.body.id);
    const before = await preview(o.body.id, { loyaltyPointsToRedeem: 0 });
    const v = await preview(o.body.id);
    expect(Number(v.loyaltyDiscountAmount)).toBe(1.5);
    expect(Number(before.totalDue) - Number(v.totalDue)).toBeCloseTo(1.5, 2);
    expect((await payInFull(o.body.id)).status).toBe(201);
    expect(await points(phone(1))).toBe(0);
    const redeem = await prisma.pointsLedger.findFirstOrThrow({
      where: { orderId: o.body.id, reason: 'REDEEM' },
    });
    expect(redeem.delta).toBe(-15);
  });

  it('cannot redeem points it does not have', async () => {
    const o = await place(phone(8), { redeemPoints: 500 }).expect(201);
    expect(o.body.rewards.redeem).toBeUndefined();
  });

  it('five simultaneous payouts for one pending referral pay exactly once', async () => {
    const o = await place(phone(9), { referralCode: code }).expect(201);
    const ref = await prisma.referral.findFirstOrThrow({
      where: { referred: { phone: phone(9) } },
    });
    const before = await points(phone(1));
    await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) =>
          referralsSvc.onOrderPaid(tx, {
            id: o.body.id,
            branchId: BRANCH,
            customerId: ref.referredId,
            totalAmount: 100,
            foodValue: 300,
          }),
        ),
      ),
    );
    expect(await points(phone(9))).toBe(10);
    expect(await points(phone(1))).toBe(before + 15);
    expect(
      await prisma.pointsLedger.count({ where: { referralId: ref.id } }),
    ).toBe(2);
  });

  it('a first order under the food-value minimum pays nothing and stays pending; a bigger one pays', async () => {
    const small = await place(phone(10), {
      referralCode: code,
      items: [{ menuItemId: 'demo-item-cola', quantity: 2 }], // 180 < 200
    }).expect(201);
    await accept(small.body.id);
    expect((await payInFull(small.body.id)).status).toBe(201);
    const ref = await prisma.referral.findFirstOrThrow({
      where: { referred: { phone: phone(10) } },
    });
    expect(ref.status).toBe('PENDING');
    expect(await points(phone(10))).toBe(0);
    const before = await points(phone(1));
    const big = await place(phone(10)).expect(201); // 270 >= 200
    await accept(big.body.id);
    expect((await payInFull(big.body.id)).status).toBe(201);
    expect(await points(phone(10))).toBe(10);
    expect(await points(phone(1))).toBe(before + 15);
  });

  it('refuses online orders below the minimum and accepts ones at or above it', async () => {
    await settings({ onlineMinOrderAmount: 200 });
    try {
      const low = await place(phone(11), {
        items: [{ menuItemId: 'demo-item-cola', quantity: 2 }],
      }).expect(400);
      expect(JSON.stringify(low.body)).toMatch(/minimum order/i);
      expect(
        await prisma.order.count({ where: { customer: { phone: phone(11) } } }),
      ).toBe(0);
      await place(phone(11)).expect(201);
    } finally {
      await settings({ onlineMinOrderAmount: 0 });
    }
  });

  it('is private: another restaurant cannot use this code', async () => {
    const other = await prisma.restaurant.create({
      data: { name: `Other ${tag}` },
    });
    const res = await referralsSvc.attach(
      other.id,
      (await prisma.customer.findFirstOrThrow({ where: { phone: phone(7) } }))
        .id,
      code,
    );
    expect(res.applied).toBe(false);
    await prisma.restaurant.delete({ where: { id: other.id } });
  });
});
