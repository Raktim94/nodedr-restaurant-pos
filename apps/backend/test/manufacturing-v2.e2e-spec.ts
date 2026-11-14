/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Manufacturing journal v2 (recipes, allocation, rejects, row locations, daily report, analysis, POS cost).
//   MFG2_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand manufacturing
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.MFG2_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);

run('Manufacturing journal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
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
  const receive = (
    ingredientId: string,
    quantity: string,
    unit: string,
    unitCost?: string,
  ) =>
    owner
      .post(`/api/v1/inventory/journal/receipts${q}`)
      .send({ ingredientId, quantity, unit, unitCost });

  const post = (
    agent: ReturnType<typeof request.agent>,
    path: string,
    body: object,
  ) => agent.post(`/api/v1/inventory/${path}${q}`).send(body);
  const today = () => new Date().toISOString();
  const make = (body: object) => post(owner, 'production', body);
  const voucher = (over: Record<string, unknown> = {}) => ({
    inputs: [
      { ingredientId: id.maida, quantity: '20', unit: 'KG' },
      { ingredientId: id.chicken, quantity: '14', unit: 'KG' },
      { ingredientId: id.veg, quantity: '10', unit: 'KG' },
    ],
    outputs: [{ ingredientId: id.momo, quantity: '200', unit: 'PIECE' }],
    costing: {
      enabled: true,
      costs: [{ category: 'Labour', amount: '300', included: true }],
    },
    post: true,
    ...over,
  });
  const entryOf = async (eid: string) =>
    (await owner.get(`/api/v1/inventory/production/${eid}${q}`).expect(200))
      .body;
  const daily = async (extra = '') =>
    (
      await owner
        .get(`/api/v1/inventory/manufacturing/daily${q}${extra}`)
        .expect(200)
    ).body;
  const localToday = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });

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
    const email = `cashier-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: `cashier ${tag}`,
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'CASHIER')!.id,
        branchIds: [BRANCH],
      })
      .expect(201);
    cashier = request.agent(app.getHttpServer());
    await cashier
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    await owner
      .patch(`/api/v1/inventory/manufacturing/settings${q}`)
      .send({ enabled: true })
      .expect(200);

    id.maida = await item('Maida', 'KG');
    id.chicken = await item('Chicken', 'KG');
    id.veg = await item('Veg', 'KG');
    id.oil = await item('Oil', 'L');
    id.momo = await item('Momo', 'PIECE', { kind: 'PREPARED' });
    id.big = await item('BigMomo', 'PIECE', { kind: 'PREPARED' });
    id.old = await item('OldItem', 'PIECE', { kind: 'PREPARED' });
    id.never = await item('NeverMade', 'PIECE', { kind: 'PREPARED' });
    await receive(id.maida, '200', 'KG', '40').expect(201);
    await receive(id.chicken, '100', 'KG', '220').expect(201);
    await receive(id.veg, '100', 'KG', '30').expect(201);
    await receive(id.oil, '10', 'L', '100').expect(201);
    id.store = (
      await post(owner, 'locations', { name: `Store ${tag}` }).expect(201)
    ).body.id;
    id.cold = (
      await post(owner, 'locations', { name: `Cold ${tag}` }).expect(201)
    ).body.id;
    await post(owner, 'locations/transfers', {
      ingredientId: id.maida,
      toLocationId: id.store,
      quantity: '30',
      unit: 'KG',
    }).expect(201);
    const cat = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body[0].id as string;
    for (const [k, ing, price] of [
      ['menuMomo', id.momo, 200],
      ['menuOld', id.old, 90],
      ['menuNever', id.never, 50],
    ] as const) {
      id[k] = (
        await owner
          .post(`/api/v1/menu/items${q}`)
          .send({
            categoryId: cat,
            name: `${k} ${tag}`,
            price,
            taxRatePercent: 0,
          })
          .expect(201)
      ).body.id;
      await owner
        .patch(`/api/v1/inventory/menu-items/${id[k]}/tracking${q}`)
        .send({
          inventoryTracking: 'DIRECT',
          stockIngredientId: ing,
          stockQuantityPerSale: 1,
        })
        .expect(200);
    }
  });
  afterAll(async () => app.close());

  it('saves a recipe with a base output, scales it to a planned batch, and bumps the version on edit', async () => {
    const r = await post(owner, 'recipes', {
      outputIngredientId: id.momo,
      name: 'Chicken momo',
      baseOutputQty: '100',
      lines: [
        { ingredientId: id.maida, quantity: '10', unit: 'KG' },
        { ingredientId: id.chicken, quantity: '8', unit: 'KG' },
        { ingredientId: id.veg, quantity: '5', unit: 'KG' },
      ],
    }).expect(201);
    id.recipe = r.body.id;
    expect(r.body.version).toBe(1);
    const list = (
      await owner
        .get(`/api/v1/inventory/recipes${q}&productId=${id.momo}`)
        .expect(200)
    ).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(id.recipe);
    const fill = (
      await owner
        .get(
          `/api/v1/inventory/recipes/fill${q}&kind=RECIPE&id=${id.recipe}&quantity=200`,
        )
        .expect(200)
    ).body;
    const by = Object.fromEntries(
      fill.lines.map((l: { name: string; quantity: string }) => [
        l.name.replace(`-${tag}`, ''),
        l.quantity,
      ]),
    );
    expect(by).toMatchObject({ Maida: '20', Chicken: '16', Veg: '10' }); // 200 planned = 2 x the 100 base
    await post(owner, 'recipes', {
      outputIngredientId: id.momo,
      name: 'Chicken momo',
      baseOutputQty: '100',
      lines: [{ ingredientId: id.maida, quantity: '1', unit: 'KG' }],
    }).expect(409); // duplicate name
    await post(owner, 'recipes', {
      outputIngredientId: id.maida,
      name: 'Bad',
      baseOutputQty: '1',
      lines: [{ ingredientId: id.veg, quantity: '1', unit: 'KG' }],
    }).expect(400); // raw material as output
  });

  let batchA = '';
  let batchB = '';
  it('batch A: 200 momo, actual chicken below recipe, recipe snapshot + expected stored, cost frozen', async () => {
    const before = { maida: await stock(id.maida), momo: await stock(id.momo) };
    const body = voucher({
      recipe: { kind: 'RECIPE', id: id.recipe },
      batchRef: 'MOMO-A',
      producedAt: today(),
      inputs: [
        {
          ingredientId: id.maida,
          quantity: '20',
          unit: 'KG',
          expectedQuantity: '20',
        },
        {
          ingredientId: id.chicken,
          quantity: '14',
          unit: 'KG',
          expectedQuantity: '16',
        },
        {
          ingredientId: id.veg,
          quantity: '10',
          unit: 'KG',
          expectedQuantity: '10',
        },
      ],
      outputs: [
        {
          ingredientId: id.momo,
          quantity: '200',
          unit: 'PIECE',
          expectedQuantity: '200',
        },
      ],
      idempotencyKey: `idem-a-${tag}`,
    });
    const r = await make(body).expect(201);
    batchA = r.body.id;
    // a double submit returns the same voucher and posts nothing twice
    expect((await make(body).expect(201)).body.id).toBe(batchA);
    const e = await entryOf(batchA);
    expect(Number(e.ingredientCost)).toBe(4180); // 20x40 + 14x220 + 10x30
    expect(Number(e.totalCost)).toBe(4480); // + 300 labour
    expect(Number(e.unitCost)).toBe(22.4);
    expect(e.recipeName).toContain('Chicken momo (v1)');
    expect(e.recipeSnapshot.baseOutputQty).toBe('100');
    const chicken = e.lines.find(
      (l: { ingredientId: string }) => l.ingredientId === id.chicken,
    );
    expect(Number(chicken.expectedQuantity)).toBe(16);
    expect(await stock(id.maida)).toBe(before.maida - 20);
    expect(await stock(id.momo)).toBe(before.momo + 200);
  });

  it('batch B: 230 good + 12 rejected; rejects are not stocked and their cost stays with the good pieces', async () => {
    const momoBefore = await stock(id.momo);
    const r = await make(
      voucher({
        batchRef: 'MOMO-B',
        producedAt: today(),
        inputs: [
          {
            ingredientId: id.maida,
            quantity: '20',
            unit: 'KG',
            expectedQuantity: '20',
          },
          {
            ingredientId: id.chicken,
            quantity: '16',
            unit: 'KG',
            expectedQuantity: '16',
          },
          {
            ingredientId: id.veg,
            quantity: '11',
            unit: 'KG',
            expectedQuantity: '10',
          },
        ],
        outputs: [
          {
            ingredientId: id.momo,
            quantity: '230',
            unit: 'PIECE',
            rejectedQuantity: '12',
            expectedQuantity: '200',
          },
        ],
      }),
    ).expect(201);
    batchB = r.body.id;
    const e = await entryOf(batchB);
    expect(Number(e.totalCost)).toBe(4950); // 800 + 3520 + 330 + 300
    const out = e.lines.find((l: { role: string }) => l.role === 'OUTPUT');
    expect(Number(out.goodUnitCost)).toBeCloseTo(4950 / 230, 3);
    expect(Number(out.rejectedQuantity)).toBe(12);
    expect(await stock(id.momo)).toBe(momoBefore + 230); // 230, not 242
    const mv = await prisma.stockMovement.findMany({
      where: { productionEntryId: batchB, type: 'PRODUCTION' },
    });
    expect(mv.reduce((s, m) => s + Number(m.quantity), 0)).toBe(230);
  });

  it('a later recipe edit does not rewrite batch A', async () => {
    const r = await owner
      .patch(`/api/v1/inventory/recipes/${id.recipe}${q}`)
      .send({
        outputIngredientId: id.momo,
        name: 'Chicken momo',
        baseOutputQty: '100',
        lines: [
          { ingredientId: id.maida, quantity: '12', unit: 'KG' },
          { ingredientId: id.chicken, quantity: '9', unit: 'KG' },
        ],
      })
      .expect(200);
    expect(r.body.version).toBe(2);
    const e = await entryOf(batchA);
    expect(e.recipeName).toContain('(v1)');
    expect(e.recipeSnapshot.lines).toHaveLength(3);
    expect(Number(e.totalCost)).toBe(4480);
  });

  it('daily report: one block for the day, both vouchers, totals equal the saved vouchers and the ledger', async () => {
    const d = await daily(
      `&from=${localToday}&to=${localToday}&productId=${id.momo}`,
    );
    const block = d.days.find((x: { date: string }) => x.date === localToday);
    expect(block).toBeDefined();
    const nums = block.vouchers.map((v: { entryNo: string }) => v.entryNo);
    expect(nums.length).toBeGreaterThanOrEqual(2);
    const sumCost = block.vouchers.reduce(
      (s: number, v: { totalCost: string }) => s + Number(v.totalCost),
      0,
    );
    expect(Number(block.totalCost)).toBeCloseTo(sumCost, 2);
    const momo = block.produced.find(
      (p: { ingredientId: string }) => p.ingredientId === id.momo,
    );
    expect(Number(momo.good)).toBe(430);
    expect(Number(momo.rejected)).toBe(12);
    expect(Number(momo.allocatedCost)).toBeCloseTo(4480 + 4950, 2);
    expect(Number(momo.unitCost)).toBeCloseTo((4480 + 4950) / 430, 3); // weighted, not an average of averages
    // consumed quantities equal the ledger's PRODUCTION_USE movements for these two vouchers
    const used = await prisma.stockMovement.findMany({
      where: {
        productionEntryId: { in: [batchA, batchB] },
        type: 'PRODUCTION_USE',
      },
    });
    const ledgerChicken = used
      .filter((m) => m.ingredientId === id.chicken)
      .reduce((s, m) => s + Number(m.quantity), 0);
    const chicken = block.consumed.find(
      (c: { ingredientId: string }) => c.ingredientId === id.chicken,
    );
    expect(Number(chicken.quantity)).toBe(-ledgerChicken);
    expect(Number(chicken.quantity)).toBe(30);
    const csv = (
      await owner
        .get(
          `/api/v1/inventory/manufacturing/daily.csv${q}&from=${localToday}&to=${localToday}&productId=${id.momo}`,
        )
        .expect(200)
    ).text;
    expect(csv).toContain('MOMO-A');
    expect(
      csv.split('\n').filter((l) => l.includes(',Consumed,')).length,
    ).toBeGreaterThanOrEqual(6);
    // filter: a batch that does not exist returns nothing
    expect((await daily(`&batchRef=NOPE-${tag}`)).days).toHaveLength(0);
  });

  it('analysis compares batches per 100 good units without ranking them', async () => {
    const a = (
      await owner
        .get(
          `/api/v1/inventory/manufacturing/analysis${q}&productId=${id.momo}`,
        )
        .expect(200)
    ).body;
    const p = a.products[0];
    const bA = p.batches.find(
      (b: { entryNo: string }) => b.entryNo === nums_of(p, batchA),
    );
    expect(bA).toBeDefined();
    const chickenA = bA.ingredients.find((i: { name: string }) =>
      i.name.startsWith('Chicken'),
    );
    expect(Number(chickenA.per100Good)).toBeCloseTo(7, 3); // 14 kg / 200 x 100
    expect(Number(chickenA.variancePercent)).toBeCloseTo(-12.5, 1); // 14 vs 16 expected
    expect(Number(bA.unitCost)).toBe(22.4);
    expect(a.note).toMatch(/not an improvement by itself/);
    function nums_of(
      pr: { batches: { voucherId: string; entryNo: string }[] },
      vid: string,
    ) {
      return pr.batches.find((b) => b.voucherId === vid)!.entryNo;
    }
  });

  it('stock shortage on any row refuses the whole voucher and leaves every stock untouched', async () => {
    const before = [
      await stock(id.maida),
      await stock(id.chicken),
      await stock(id.momo),
    ];
    const r = await make(
      voucher({
        inputs: [
          { ingredientId: id.maida, quantity: '5', unit: 'KG' },
          { ingredientId: id.chicken, quantity: '9999', unit: 'KG' },
        ],
      }),
    );
    expect(r.status).toBe(400);
    expect([
      await stock(id.maida),
      await stock(id.chicken),
      await stock(id.momo),
    ]).toEqual(before);
    const pv = (
      await post(owner, 'production/voucher-preview', {
        inputs: [{ ingredientId: id.chicken, quantity: '9999', unit: 'KG' }],
        outputs: [{ ingredientId: id.momo, quantity: '1', unit: 'PIECE' }],
        costing: { enabled: true, costs: [] },
      }).expect(201)
    ).body;
    expect(pv.canPost).toBe(false);
    expect(pv.shortages.join(' ')).toMatch(/only/);
  });

  it('unit conversion: 2000 G of chicken is 2 KG; an unconvertible unit is refused', async () => {
    const before = await stock(id.chicken);
    await make(
      voucher({
        inputs: [{ ingredientId: id.chicken, quantity: '2000', unit: 'G' }],
        outputs: [{ ingredientId: id.momo, quantity: '10', unit: 'PIECE' }],
      }),
    ).expect(201);
    expect(await stock(id.chicken)).toBe(before - 2);
    expect(
      (
        await make(
          voucher({
            inputs: [{ ingredientId: id.chicken, quantity: '1', unit: 'L' }],
          }),
        )
      ).status,
    ).toBe(400);
  });

  it('several products: shared cost needs a split method, a 100% manual split, or a same-unit quantity split', async () => {
    const outs = (extra: object[] = [{}, {}]) => [
      { ingredientId: id.momo, quantity: '150', unit: 'PIECE', ...extra[0] },
      { ingredientId: id.big, quantity: '50', unit: 'PIECE', ...extra[1] },
    ];
    const inputs = [
      { ingredientId: id.maida, quantity: '10', unit: 'KG' },
      { ingredientId: id.chicken, quantity: '5', unit: 'KG' },
    ]; // 400 + 1100
    expect((await make(voucher({ inputs, outputs: outs() }))).status).toBe(400); // no method
    expect(
      (
        await make(
          voucher({
            inputs,
            outputs: outs([
              { allocationPercent: '60' },
              { allocationPercent: '30' },
            ]),
            allocationMethod: 'MANUAL',
          }),
        )
      ).status,
    ).toBe(400); // 90%
    const q1 = await make(
      voucher({ inputs, outputs: outs(), allocationMethod: 'QUANTITY' }),
    ).expect(201);
    const e1 = await entryOf(q1.body.id);
    const o1 = e1.lines.filter((l: { role: string }) => l.role === 'OUTPUT');
    // shared cost = 400 + 1100 + 300 labour = 1800, split 150:50
    const cost = (
      rows: {
        ingredientId: string;
        allocatedCost: string;
        goodUnitCost: string;
      }[],
      iid: string,
    ) => rows.find((l) => l.ingredientId === iid)!;
    expect(Number(cost(o1, id.momo).allocatedCost)).toBe(1350);
    expect(Number(cost(o1, id.big).allocatedCost)).toBe(450);
    expect(Number(cost(o1, id.momo).goodUnitCost)).toBe(9); // 1350 / 150
    expect(Number(cost(o1, id.big).goodUnitCost)).toBe(9);
    expect(Number(e1.totalCost)).toBe(1800);
    // manual 60/40 with maida tied wholly to the big momo: direct 400 to big; shared 1100 + 300 = 1400 -> 840 / 560
    const m1 = await make(
      voucher({
        inputs: [
          {
            ingredientId: id.maida,
            quantity: '10',
            unit: 'KG',
            directToIngredientId: id.big,
          },
          { ingredientId: id.chicken, quantity: '5', unit: 'KG' },
        ],
        outputs: outs([
          { allocationPercent: '60' },
          { allocationPercent: '40' },
        ]),
        allocationMethod: 'MANUAL',
      }),
    ).expect(201);
    const o2 = (await entryOf(m1.body.id)).lines.filter(
      (l: { role: string }) => l.role === 'OUTPUT',
    );
    expect(Number(cost(o2, id.momo).allocatedCost)).toBe(840);
    expect(Number(cost(o2, id.big).allocatedCost)).toBe(960); // 400 direct + 560
    // the preview refuses to show a per-product cost while the split is incomplete
    const pv = (
      await post(owner, 'production/voucher-preview', {
        inputs,
        outputs: outs(),
        costing: { enabled: true, costs: [] },
      }).expect(201)
    ).body;
    expect(pv.costError).toMatch(/Choose how shared cost/);
    expect(pv.outputs[0].unitCost).toBeNull();
    expect(pv.canPost).toBe(false);
  });

  it('row-level places: the place must hold the stock; output lands in its place; reversal restores both', async () => {
    const level = async (iid: string, loc: string) =>
      Number(
        (
          await prisma.stockLevel.findUnique({
            where: {
              ingredientId_locationId: { ingredientId: iid, locationId: loc },
            },
          })
        )?.quantity ?? 0,
      );
    expect(await level(id.maida, id.store)).toBe(30);
    const tooMuch = await make(
      voucher({
        inputs: [
          {
            ingredientId: id.maida,
            quantity: '31',
            unit: 'KG',
            locationId: id.store,
          },
        ],
        outputs: [{ ingredientId: id.momo, quantity: '10', unit: 'PIECE' }],
      }),
    );
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message).toMatch(/recorded in/);
    expect(await level(id.maida, id.store)).toBe(30);
    const totalBefore = await stock(id.maida);
    const ok = await make(
      voucher({
        inputs: [
          {
            ingredientId: id.maida,
            quantity: '12',
            unit: 'KG',
            locationId: id.store,
            lotNumber: 'LOT-M1',
          },
        ],
        outputs: [
          {
            ingredientId: id.momo,
            quantity: '40',
            unit: 'PIECE',
            locationId: id.cold,
            lotNumber: 'LOT-OUT',
          },
        ],
      }),
    ).expect(201);
    expect(await level(id.maida, id.store)).toBe(18);
    expect(await level(id.momo, id.cold)).toBe(40);
    expect(await stock(id.maida)).toBe(totalBefore - 12);
    const mvs = await prisma.stockMovement.findMany({
      where: { productionEntryId: ok.body.id },
    });
    expect(mvs.find((m) => m.type === 'PRODUCTION_USE')!.locationId).toBe(
      id.store,
    );
    expect(mvs.find((m) => m.type === 'PRODUCTION')!.locationId).toBe(id.cold);
    const byPlace = (
      await owner
        .get(`/api/v1/inventory/journal${q}&locationId=${id.cold}`)
        .expect(200)
    ).body.items;
    expect(
      byPlace.every((m: { locationId: string }) => m.locationId === id.cold),
    ).toBe(true);
    expect(byPlace.length).toBeGreaterThan(0);
    const filtered = await daily(`&locationId=${id.cold}`);
    expect(
      filtered.days
        .flatMap((d: { vouchers: { id: string }[] }) => d.vouchers)
        .map((v: { id: string }) => v.id),
    ).toContain(ok.body.id);
    await post(owner, `production/${ok.body.id}/void`, {
      reason: 'wrong count',
    }).expect(201);
    expect(await level(id.maida, id.store)).toBe(30);
    expect(await level(id.momo, id.cold)).toBe(0);
    expect(await stock(id.maida)).toBe(totalBefore);
    // a reversed voucher disappears from the posted daily report
    expect(
      (await daily(`&locationId=${id.cold}`)).days
        .flatMap((d: { vouchers: { id: string }[] }) => d.vouchers)
        .map((v: { id: string }) => v.id),
    ).not.toContain(ok.body.id);
  });

  it('drafts do not move stock or appear in reports; posting one does; a corrected voucher shows once', async () => {
    const mBefore = await stock(id.momo);
    const draft = await make(
      voucher({
        post: false,
        batchRef: `DRAFT-X-${tag}`,
        outputs: [{ ingredientId: id.momo, quantity: '7', unit: 'PIECE' }],
      }),
    ).expect(201);
    expect(await stock(id.momo)).toBe(mBefore);
    expect((await daily(`&batchRef=DRAFT-X-${tag}`)).days).toHaveLength(0);
    await post(owner, `production/${draft.body.id}/post`, {}).expect(201);
    expect(await stock(id.momo)).toBe(mBefore + 7);
    expect(
      (await daily(`&batchRef=DRAFT-X-${tag}`)).days.flatMap(
        (d: { vouchers: unknown[] }) => d.vouchers,
      ),
    ).toHaveLength(1);
    await post(owner, `production/${draft.body.id}/correct`, {
      ...voucher({
        batchRef: `DRAFT-X-${tag}`,
        outputs: [{ ingredientId: id.momo, quantity: '9', unit: 'PIECE' }],
      }),
      reason: 'miscount',
      post: undefined,
    }).expect(201);
    expect(await stock(id.momo)).toBe(mBefore + 9);
    const after = (await daily(`&batchRef=DRAFT-X-${tag}`)).days.flatMap(
      (d: { vouchers: { outputs: { good: string }[] }[] }) => d.vouchers,
    );
    expect(after).toHaveLength(1); // the original is reversed, only its replacement counts
    expect(Number(after[0].outputs[0].good)).toBe(9);
  });

  it('PO context is recorded, and the run never receives stock a second time', async () => {
    const sup = (
      await post(owner, 'suppliers', { name: `Sup ${tag}` }).expect(201)
    ).body.id;
    const po = (
      await post(owner, 'purchase-orders', {
        supplierId: sup,
        items: [{ ingredientId: id.veg, quantityOrdered: 40, unitCost: 30 }],
      }).expect(201)
    ).body;
    await owner
      .patch(`/api/v1/inventory/purchase-orders/${po.id}/status${q}`)
      .send({ status: 'SENT' })
      .expect(200);
    await post(owner, 'goods-receipts', {
      supplierId: sup,
      purchaseOrderId: po.id,
      items: [
        {
          ingredientId: id.veg,
          purchaseOrderItemId: po.items[0].id,
          quantity: 15,
          unitCost: 30,
        },
      ],
    }).expect(201); // partial
    const detail = (
      await owner
        .get(`/api/v1/inventory/purchase-orders/${po.id}${q}`)
        .expect(200)
    ).body;
    expect(detail.status).toBe('PARTIALLY_RECEIVED');
    expect(Number(detail.items[0].quantityReceived)).toBe(15); // the screen preloads this, not the 40 ordered
    const receiptsBefore = await prisma.stockMovement.count({
      where: { ingredientId: id.veg, type: 'RECEIPT' },
    });
    const vegBefore = await stock(id.veg);
    for (const n of [1, 2]) {
      const r = await make(
        voucher({
          sourcePoId: po.id,
          batchRef: `${po.poNumber}-RUN${n}`,
          inputs: [{ ingredientId: id.veg, quantity: '5', unit: 'KG' }],
          outputs: [{ ingredientId: id.momo, quantity: '20', unit: 'PIECE' }],
        }),
      ).expect(201);
      const e = await entryOf(r.body.id);
      expect(e.sourcePoNumber).toBe(po.poNumber);
      expect(e.sourceSupplier).toBe(`Sup ${tag}`);
    }
    expect(await stock(id.veg)).toBe(vegBefore - 10); // consumption only
    expect(
      await prisma.stockMovement.count({
        where: { ingredientId: id.veg, type: 'RECEIPT' },
      }),
    ).toBe(receiptsBefore); // no second receipt
    expect(
      Number(
        (
          await owner
            .get(`/api/v1/inventory/purchase-orders/${po.id}${q}`)
            .expect(200)
        ).body.items[0].quantityReceived,
      ),
    ).toBe(15);
    const byPo = await daily(`&po=${po.poNumber}`);
    expect(
      byPo.days.flatMap((d: { vouchers: unknown[] }) => d.vouchers),
    ).toHaveLength(2);
  });

  it("POS cost: today uses the weighted average of today's batches; an older cost is dated, not called today; no history = none", async () => {
    const old = new Date(Date.now() - 3 * 864e5).toISOString();
    await make(
      voucher({
        producedAt: old,
        inputs: [{ ingredientId: id.maida, quantity: '5', unit: 'KG' }],
        outputs: [{ ingredientId: id.old, quantity: '50', unit: 'PIECE' }],
        costing: { enabled: true, costs: [] },
      }),
    ).expect(201);
    const mc = (
      await owner
        .get(`/api/v1/inventory/manufacturing/menu-costs${q}`)
        .expect(200)
    ).body;
    const momo = mc.items.find(
      (x: { menuItemId: string }) => x.menuItemId === id.menuMomo,
    );
    expect(momo.isToday).toBe(true);
    expect(momo.price).toBe('200.00');
    const rows = await prisma.productionLine.findMany({
      where: {
        ingredientId: id.momo,
        role: 'OUTPUT',
        allocatedCost: { not: null },
        entry: {
          status: 'POSTED',
          costed: true,
          producedAt: { gte: new Date(Date.now() - 864e5) },
        },
      },
    });
    const cost = rows.reduce((s, l) => s + Number(l.allocatedCost), 0);
    const good = rows.reduce((s, l) => s + Number(l.quantity), 0);
    expect(Number(momo.costPerPortion)).toBeCloseTo(cost / good, 2);
    expect(Number(momo.indicativeDifference)).toBeCloseTo(200 - cost / good, 2);
    const o = mc.items.find(
      (x: { menuItemId: string }) => x.menuItemId === id.menuOld,
    );
    expect(o.isToday).toBe(false);
    expect(o.costDate < localToday).toBe(true);
    expect(Number(o.costPerPortion)).toBe(4); // 5 kg x 40 = 200 / 50 pieces
    expect(
      mc.items.find(
        (x: { menuItemId: string }) => x.menuItemId === id.menuNever,
      ),
    ).toBeUndefined();
    expect(
      (await cashier.get(`/api/v1/inventory/manufacturing/menu-costs${q}`))
        .status,
    ).toBe(403); // cost is for people who may see reports
  });
});
