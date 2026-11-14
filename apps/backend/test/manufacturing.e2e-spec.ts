/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Costed production (the manufacturing journal) against a real Postgres.
//   MFG_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand manufacturing
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.MFG_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);

run('Manufacturing journal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let chef: ReturnType<typeof request.agent>; // CHEF: records and posts, but no price and no reports
  let draftOnly: ReturnType<typeof request.agent>; // custom role: production.record only
  let cashier: ReturnType<typeof request.agent>;
  const id: Record<string, string> = {};

  const item = async (name: string, unit: string, extra: object = {}) =>
    (
      await owner
        .post(`/api/v1/inventory/ingredients${q}`)
        .send({ name: `${name}-${tag}`, unit, ...extra })
        .expect(201)
    ).body.id as string;
  const stock = async (i: string) =>
    Number(
      (await owner.get(`/api/v1/inventory/ingredients/${i}${q}`).expect(200))
        .body.currentStock,
    );
  const price = async () =>
    Number(
      (await owner.get(`/api/v1/menu/items/${id.menu}${q}`).expect(200)).body
        .price,
    );
  const receive = (
    ingredientId: string,
    quantity: string,
    unit: string,
    unitCost?: string,
  ) =>
    owner
      .post(`/api/v1/inventory/journal/receipts${q}`)
      .send({ ingredientId, quantity, unit, unitCost });
  const batch = (over: object = {}) => ({
    inputs: [
      { ingredientId: id.rice, quantity: '6', unit: 'KG' },
      { ingredientId: id.dal, quantity: '2000', unit: 'G' },
    ],
    outputs: [{ ingredientId: id.idli, quantity: '120', unit: 'PIECE' }],
    costing: {
      enabled: true,
      costs: [
        { category: 'Labour', amount: '150', included: true },
        { category: 'Rent share', amount: '500', included: false },
      ],
    },
    post: true,
    ...over,
  });
  const make = (agent: ReturnType<typeof request.agent>, body: object) =>
    agent.post(`/api/v1/inventory/production${q}`).send(body);

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
    const mk = async (roleId: string, label: string) => {
      const email = `${label}-${tag}@demo.local`;
      await owner
        .post('/api/v1/users')
        .send({
          name: `${label} ${tag}`,
          email,
          password: 'Password123!',
          roleId,
          branchIds: [BRANCH],
        })
        .expect(201);
      const a = request.agent(app.getHttpServer());
      await a
        .post('/api/v1/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(201);
      return a;
    };
    chef = await mk(roles.find((r) => r.name === 'CHEF')!.id, 'chef');
    cashier = await mk(roles.find((r) => r.name === 'CASHIER')!.id, 'cashier');
    const restaurantId = (
      await prisma.branch.findUniqueOrThrow({ where: { id: BRANCH } })
    ).restaurantId;
    const role = await prisma.role.create({
      data: {
        restaurantId,
        name: `DRAFT_ONLY_${tag}`,
        label: 'Draft only',
        isSystem: false,
      },
    });
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { key: 'production.record' },
    });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
    draftOnly = await mk(role.id, 'draftonly');

    await owner
      .patch(`/api/v1/inventory/manufacturing/settings${q}`)
      .send({ enabled: false })
      .expect(200); // start from a known state
    id.rice = await item('Rice', 'KG');
    id.dal = await item('Dal', 'KG');
    id.nocost = await item('Salt', 'KG');
    id.idli = await item('Idli', 'PIECE', { kind: 'PREPARED' });
    await receive(id.rice, '30', 'KG', '60').expect(201);
    await receive(id.dal, '10', 'KG', '120.5').expect(201);
    await receive(id.nocost, '5', 'KG').expect(201); // received with no cost
    const cat = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body[0].id as string;
    id.menu = (
      await owner
        .post(`/api/v1/menu/items${q}`)
        .send({
          categoryId: cat,
          name: `Idli plate ${tag}`,
          price: 10,
          taxRatePercent: 0,
        })
        .expect(201)
    ).body.id;
    await owner
      .patch(`/api/v1/inventory/menu-items/${id.menu}/tracking${q}`)
      .send({
        inventoryTracking: 'DIRECT',
        stockIngredientId: id.idli,
        stockQuantityPerSale: 1,
      })
      .expect(200);
  });
  afterAll(async () => app.close());

  it('refuses a costed batch while manufacturing is switched off, and nothing moves', async () => {
    const r = await make(owner, batch());
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/switched off/);
    expect(await stock(id.rice)).toBe(30);
    await owner
      .patch(`/api/v1/inventory/manufacturing/settings${q}`)
      .send({ enabled: true })
      .expect(200);
    expect(
      (
        await cashier
          .patch(`/api/v1/inventory/manufacturing/settings${q}`)
          .send({ enabled: false })
      ).status,
    ).toBe(403);
  });

  it('previews on the server: rates, line costs, extra costs, unit cost; flags missing rates and shortages', async () => {
    const p = (
      await owner
        .post(`/api/v1/inventory/manufacturing/preview${q}`)
        .send({
          inputs: batch().inputs,
          outputs: batch().outputs,
          costing: batch().costing,
        })
        .expect(201)
    ).body;
    expect(p.ingredientCost).toBe('601'); // 6 kg x 60 + 2 kg x 120.5
    expect(p.additionalCost).toBe('150'); // the excluded Rent share is not counted
    expect(p.totalCost).toBe('751');
    expect(p.unitCost).toBe('6.2583'); // 751 / 120
    expect(p.menuItem.id).toBe(id.menu);
    expect(p.currentPrice).toBe('10.00');
    expect(p.pricesIncludeTax).toBe(true);
    const lowPrice = (
      await owner
        .post(`/api/v1/inventory/manufacturing/preview${q}`)
        .send({
          inputs: batch().inputs,
          outputs: batch().outputs,
          costing: {
            ...batch().costing,
            menuPrice: {
              menuItemId: id.menu,
              newPrice: '5',
              expectedCurrentPrice: '10',
            },
          },
        })
        .expect(201)
    ).body;
    expect(Number(lowPrice.proposedPriceMetrics.marginPercent)).toBeLessThan(0); // selling under cost shows as a loss
    const noCost = (
      await owner
        .post(`/api/v1/inventory/manufacturing/preview${q}`)
        .send({
          inputs: [{ ingredientId: id.nocost, quantity: '1', unit: 'KG' }],
          outputs: batch().outputs,
          costing: { enabled: true, costs: [] },
        })
        .expect(201)
    ).body;
    expect(noCost.missingRates).toHaveLength(1);
    expect(noCost.canPost).toBe(false);
    const short = (
      await owner
        .post(`/api/v1/inventory/manufacturing/preview${q}`)
        .send({
          inputs: [{ ingredientId: id.rice, quantity: '999', unit: 'KG' }],
          outputs: batch().outputs,
          costing: { enabled: true, costs: [] },
        })
        .expect(201)
    ).body;
    expect(short.shortages).toHaveLength(1);
    expect(short.canPost).toBe(false);
  });

  it('posts a costed batch: stock moves, the cost snapshot is stored, nothing changes the menu price unless asked', async () => {
    const res = await make(
      owner,
      batch({ idempotencyKey: `mfg-${randomUUID()}` }),
    ).expect(201);
    id.entry = res.body.id;
    expect(res.body.costed).toBe(true);
    expect(Number(res.body.totalCost)).toBe(751);
    expect(Number(res.body.unitCost)).toBeCloseTo(6.2583, 4);
    expect(await stock(id.rice)).toBe(24);
    expect(await stock(id.idli)).toBe(120);
    expect(await price()).toBe(10); // cost never drives the price by itself
    const line = res.body.lines.find(
      (l: { role: string; ingredientId: string }) =>
        l.role === 'INPUT' && l.ingredientId === id.rice,
    );
    expect(Number(line.unitRate)).toBe(60);
    expect(Number(line.lineCost)).toBe(360);
  });

  it('historical cost does not move when ingredient prices change later', async () => {
    await receive(id.rice, '10', 'KG', '90').expect(201); // rice is now dearer
    const rep = (
      await owner.get(`/api/v1/inventory/manufacturing/report${q}`).expect(200)
    ).body;
    const b = rep.batches.find((x: { id: string }) => x.id === id.entry);
    expect(b.totalCost).toBe('751.00');
    expect(b.unitCost).toBe('6.2583');
  });

  it('a user who may record but not price cannot change the price, and the whole batch is refused', async () => {
    const before = await stock(id.rice);
    const body = batch({
      costing: {
        ...batch().costing,
        menuPrice: {
          menuItemId: id.menu,
          newPrice: '15',
          expectedCurrentPrice: '10',
        },
      },
    });
    const r = await make(chef, body);
    expect(r.status).toBe(403);
    expect(await stock(id.rice)).toBe(before);
    expect(await price()).toBe(10);
  });

  it('a user who may only record can save a draft but cannot post it', async () => {
    const d = await make(draftOnly, batch({ post: false })).expect(201);
    expect(d.body.status).toBe('DRAFT');
    expect((await make(draftOnly, batch({ post: true }))).status).toBe(403);
    expect(
      (
        await draftOnly.post(
          `/api/v1/inventory/production/${d.body.id}/post${q}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await cashier.get(`/api/v1/inventory/manufacturing/report${q}`)).status,
    ).toBe(403);
    expect(
      (await chef.get(`/api/v1/inventory/manufacturing/report${q}`)).status,
    ).toBe(403); // chefs post; reports are for managers
  });

  it('changes the menu price from the batch in the same transaction, records who/when/old/new, and leaves finished bills alone', async () => {
    const res = await make(
      owner,
      batch({
        costing: {
          ...batch().costing,
          menuPrice: {
            menuItemId: id.menu,
            newPrice: '15',
            expectedCurrentPrice: '10',
          },
        },
        idempotencyKey: `mfg-${randomUUID()}`,
      }),
    ).expect(201);
    id.entry2 = res.body.id;
    expect(await price()).toBe(15);
    const rep = (
      await owner.get(`/api/v1/inventory/manufacturing/report${q}`).expect(200)
    ).body;
    const pc = rep.priceChanges.find(
      (p: { entryNo: string }) => p.entryNo === res.body.entryNo,
    );
    expect(pc.oldPrice).toBe('10.00');
    expect(pc.newPrice).toBe('15.00');
    expect(pc.by).toMatch(/Demo Owner|owner/i);
    expect(pc.unitCost).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'menu.price_changed', entityId: id.menu },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses to overwrite a price that changed after the form was opened, and posts nothing', async () => {
    const rice = await stock(id.rice);
    await owner
      .patch(`/api/v1/menu/items/${id.menu}${q}`)
      .send({ price: 18 })
      .expect(200); // someone else edits the price
    const r = await make(
      owner,
      batch({
        costing: {
          ...batch().costing,
          menuPrice: {
            menuItemId: id.menu,
            newPrice: '20',
            expectedCurrentPrice: '15',
          },
        },
      }),
    );
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PRICE_CONFLICT');
    expect(r.body.currentPrice).toBe('18.00');
    expect(await stock(id.rice)).toBe(rice); // atomic: no stock change either
    expect(await price()).toBe(18);
  });

  it('rejects incomplete or impossible costing without touching stock', async () => {
    const rice = await stock(id.rice);
    for (const bad of [
      batch({
        outputs: [{ ingredientId: id.idli, quantity: '0', unit: 'PIECE' }],
      }),
      batch({
        costing: {
          enabled: true,
          costs: [{ category: 'Labour', amount: '-5', included: true }],
        },
      }),
      batch({
        costing: {
          enabled: true,
          costs: [{ category: '', amount: '5', included: true }],
        },
      }),
      batch({
        inputs: [{ ingredientId: id.rice, quantity: '1', unit: 'PIECE' }],
      }),
      batch({
        inputs: [{ ingredientId: id.nocost, quantity: '1', unit: 'KG' }],
      }), // no rate anywhere
      batch({
        inputs: [
          { ingredientId: id.rice, quantity: '1', unit: 'KG', rate: '-3' },
        ],
      }),
      batch({
        costing: {
          enabled: true,
          costs: [],
          menuPrice: {
            menuItemId: id.menu,
            newPrice: '0',
            expectedCurrentPrice: '18',
          },
        },
      }),
    ]) {
      const r = await make(owner, bad);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    expect(await stock(id.rice)).toBe(rice);
  });

  it('a retried request posts once', async () => {
    const key = `mfg-${randomUUID()}`;
    const rice = await stock(id.rice);
    const a = await make(owner, batch({ idempotencyKey: key })).expect(201);
    const b = await make(owner, batch({ idempotencyKey: key })).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await stock(id.rice)).toBe(rice - 6);
  });

  it('a typed rate overrides the average and is what gets frozen', async () => {
    const r = await make(
      owner,
      batch({
        inputs: [
          { ingredientId: id.rice, quantity: '2', unit: 'KG', rate: '100' },
        ],
        costing: { enabled: true, costs: [] },
        outputs: [{ ingredientId: id.idli, quantity: '4', unit: 'PIECE' }],
      }),
    ).expect(201);
    expect(Number(r.body.ingredientCost)).toBe(200);
    expect(Number(r.body.unitCost)).toBe(50);
  });

  it('freezes the menu price at posting and carries inspection, batch details and lines into the report; "Not recorded" until inspected', async () => {
    await receive(id.rice, '10', 'KG', '60').expect(201);
    await receive(id.dal, '5', 'KG', '120.5').expect(201);
    const priceThen = await price();
    const posted = (
      await make(
        owner,
        batch({ idempotencyKey: `mfg-${randomUUID()}`, batchRef: `B-${tag}` }),
      ).expect(201)
    ).body;
    const find = async () => {
      const rep = (
        await owner
          .get(`/api/v1/inventory/manufacturing/report${q}&itemId=${id.idli}`)
          .expect(200)
      ).body;
      return rep.batches.find((b: { id: string }) => b.id === posted.id);
    };
    let row = await find();
    expect(Number(row.sellingPriceAtPost)).toBe(priceThen);
    expect(row.quality).toBeNull(); // never implied to have passed
    expect(
      row.lines.filter((l: { role: string }) => l.role === 'INPUT'),
    ).toHaveLength(2);
    expect(
      row.additionalCosts.some(
        (c: { category: string }) => c.category === 'Labour',
      ),
    ).toBe(true);

    // A later price edit never rewrites what the voucher recorded.
    await owner
      .patch(`/api/v1/menu/items/${id.menu}${q}`)
      .send({ price: priceThen + 7 })
      .expect(200);
    expect(Number((await find()).sellingPriceAtPost)).toBe(priceThen);
    await owner
      .patch(`/api/v1/menu/items/${id.menu}${q}`)
      .send({ price: priceThen })
      .expect(200);

    // Quality: needs its own permission; a fail needs a reason; the change history is kept in the audit log.
    const url = `/api/v1/inventory/production/${posted.id}/quality${q}`;
    expect((await cashier.patch(url).send({ result: 'PASS' })).status).toBe(
      403,
    );
    expect((await chef.patch(url).send({ result: 'FAIL' })).status).toBe(400);
    expect((await chef.patch(url).send({ result: 'MAYBE' })).status).toBe(400);
    await chef
      .patch(url)
      .send({ result: 'PASS', grade: 'A', notes: 'Soft, even' })
      .expect(200);
    row = await find();
    expect(row.quality).toEqual(
      expect.objectContaining({
        result: 'PASS',
        grade: 'A',
        notes: 'Soft, even',
      }),
    );
    await owner
      .patch(url)
      .send({ result: 'NEEDS_REVIEW', notes: 'Slightly sour' })
      .expect(200);
    expect((await find()).quality.result).toBe('NEEDS_REVIEW');
    const audits = await prisma.auditLog.findMany({
      where: {
        entity: 'ProductionEntry',
        entityId: posted.id,
        action: 'production.quality',
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits[1].metadata)).toContain('"result":"PASS"'); // the earlier result is preserved in the trail
    expect(
      (
        await owner
          .get(`/api/v1/inventory/manufacturing/report.csv${q}&section=batches`)
          .expect(200)
      ).text,
    ).toContain('NEEDS_REVIEW');

    // A draft cannot be inspected.
    const draft = (
      await make(
        owner,
        batch({ post: false, idempotencyKey: `mfg-${randomUUID()}` }),
      ).expect(201)
    ).body;
    expect(
      (
        await owner
          .patch(`/api/v1/inventory/production/${draft.id}/quality${q}`)
          .send({ result: 'PASS' })
      ).status,
    ).toBe(400);
  });

  it('reports are built from posted snapshots: by day, by item, ingredients, cost categories; reversed batches are excluded from totals but listed', async () => {
    const before = (
      await owner
        .get(`/api/v1/inventory/manufacturing/report${q}&itemId=${id.idli}`)
        .expect(200)
    ).body;
    const qtyBefore = Number(before.produced[0].quantity);
    await owner
      .post(`/api/v1/inventory/production/${id.entry}/void${q}`)
      .send({ reason: 'Counted twice' })
      .expect(201);
    const rep = (
      await owner
        .get(`/api/v1/inventory/manufacturing/report${q}&itemId=${id.idli}`)
        .expect(200)
    ).body;
    expect(Number(rep.produced[0].quantity)).toBe(qtyBefore - 120);
    expect(
      rep.batches.find((b: { id: string }) => b.id === id.entry).status,
    ).toBe('VOIDED');
    expect(
      rep.additionalByCategory.find(
        (c: { category: string }) => c.category === 'Rent share',
      ),
    ).toBeUndefined(); // excluded costs are not product cost
    expect(
      rep.additionalByCategory.find(
        (c: { category: string }) => c.category === 'Labour',
      ),
    ).toBeTruthy();
    expect(rep.consumed.length).toBeGreaterThan(0);
    expect(rep.batchesByDay.length).toBeGreaterThan(0);
    expect(rep.note).toMatch(/frozen/);
    for (const section of [
      'batches',
      'days',
      'produced',
      'consumed',
      'costs',
      'prices',
    ]) {
      expect(
        (
          await owner
            .get(
              `/api/v1/inventory/manufacturing/report.csv${q}&section=${section}`,
            )
            .expect(200)
        ).text.length,
      ).toBeGreaterThan(5);
    }
    expect(await price()).toBe(18); // reversing stock never silently moves a price
  });

  it('turning manufacturing off hides new costed batches but keeps every record', async () => {
    await owner
      .patch(`/api/v1/inventory/manufacturing/settings${q}`)
      .send({ enabled: false })
      .expect(200);
    expect((await make(owner, batch())).status).toBe(400);
    const rep = (
      await owner.get(`/api/v1/inventory/manufacturing/report${q}`).expect(200)
    ).body;
    expect(rep.batches.length).toBeGreaterThan(0);
    await owner
      .patch(`/api/v1/inventory/manufacturing/settings${q}`)
      .send({ enabled: true })
      .expect(200);
  });
});
