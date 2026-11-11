/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Recipe costing end-to-end against a REAL, migrated + seeded Postgres.
//   COSTING_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json recipe-costing
// Uses the seeded demo branch and throw-away, uniquely named ingredients/items, so it can be re-run.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.COSTING_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6);

run('Recipe costing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let invMgr: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let categoryId: string;
  const id: Record<string, string> = {};

  const stockOf = async (ingredientId: string) =>
    Number(
      (
        await owner
          .get(`/api/v1/inventory/ingredients/${ingredientId}${q}`)
          .expect(200)
      ).body.currentStock,
    );

  const ingredient = async (
    name: string,
    body: Record<string, unknown>,
    stock = 0,
  ) => {
    const res = await owner
      .post(`/api/v1/inventory/ingredients${q}`)
      .send({ name: `${name}-${tag}`, ...body });
    if (res.status !== 201)
      throw new Error(`ingredient ${name}: ${JSON.stringify(res.body)}`);
    if (stock) {
      await owner
        .post(`/api/v1/inventory/ingredients/${res.body.id}/adjust${q}`)
        .send({ quantity: stock, note: 'e2e opening stock' })
        .expect(201);
    }
    return res.body.id as string;
  };
  const menuItem = async (
    name: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await owner.post(`/api/v1/menu/items${q}`).send({
      categoryId,
      name: `${name}-${tag}`,
      price: 100,
      taxRatePercent: 0,
      ...extra,
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.id as string;
  };
  const saveRecipe = (itemId: string, body: Record<string, unknown>) =>
    owner.put(`/api/v1/costing/menu-items/${itemId}${q}`).send({
      overheads: [],
      halfPortionRatio: 0.5,
      alertDropPoints: 5,
      ...body,
    });
  const view = async (itemId: string) =>
    (await owner.get(`/api/v1/costing/menu-items/${itemId}${q}`).expect(200))
      .body;

  const newOrder = async (items: Record<string, unknown>[]) => {
    const res = await owner.post(`/api/v1/orders${q}`).send({
      type: 'TAKEAWAY',
      items: items.map((i) => ({ modifierIds: [], ...i })),
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body as {
      id: string;
      totalAmount: string;
      items: { id: string; menuItemId: string }[];
    };
  };
  const pay = (o: { id: string; totalAmount: string }) =>
    owner
      .post(`/api/v1/orders/${o.id}/checkout${q}`)
      .send({ payments: [{ method: 'CASH', amount: Number(o.totalAmount) }] });
  const frozenCost = async (orderItemId: string) =>
    (await prisma.orderItemCost.findUnique({ where: { orderItemId } }))
      ?.unitCost;

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
    const login = async (roleName: string) => {
      const email = `${roleName.toLowerCase()}-${tag}@demo.local`;
      await owner
        .post('/api/v1/users')
        .send({
          name: `${roleName} ${tag}`,
          email,
          password: 'Password123!',
          roleId: roles.find((r) => r.name === roleName)!.id,
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
    invMgr = await login('INVENTORY_MANAGER');
    cashier = await login('CASHIER');

    categoryId = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body[0].id;

    // flour: ₹250 for a 5 kg bag, entered by hand => ₹50/kg
    id.flour = await ingredient(
      'flour',
      {
        unit: 'KG',
        costMethod: 'MANUAL',
        purchaseQuantity: 5,
        purchaseUnit: 'KG',
        purchasePrice: 250,
      },
      100,
    );
    // rice: ₹100/kg, only 80% is usable after cleaning
    id.rice = await ingredient(
      'rice',
      {
        unit: 'KG',
        costMethod: 'MANUAL',
        purchaseQuantity: 1,
        purchaseUnit: 'KG',
        purchasePrice: 100,
        yieldPercent: 80,
      },
      100,
    );
    id.onion = await ingredient(
      'onion',
      {
        unit: 'KG',
        costMethod: 'MANUAL',
        purchaseQuantity: 1,
        purchaseUnit: 'KG',
        purchasePrice: 40,
      },
      50,
    );
    id.oil = await ingredient(
      'oil',
      {
        unit: 'L',
        costMethod: 'MANUAL',
        purchaseQuantity: 1,
        purchaseUnit: 'L',
        purchasePrice: 120,
        conversions: [{ unit: 'G', per: 920 }],
      },
      50,
    );
    id.egg = await ingredient(
      'egg',
      {
        unit: 'PIECE',
        costMethod: 'MANUAL',
        purchaseQuantity: 30,
        purchaseUnit: 'PIECE',
        purchasePrice: 300,
      },
      500,
    );
    // cheese is valued from real purchases (goods receipt), not typed in
    id.cheese = await ingredient('cheese', { unit: 'KG' });
    const supplier = await owner
      .post(`/api/v1/inventory/suppliers${q}`)
      .send({ name: `Dairy ${tag}` })
      .expect(201);
    await owner
      .post(`/api/v1/inventory/goods-receipts${q}`)
      .send({
        supplierId: supplier.body.id,
        items: [{ ingredientId: id.cheese, quantity: 10, unitCost: 400 }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Ingredients ------------------------------------------------------------------

  it('rejects a purchase unit that cannot be converted to the stock unit', async () => {
    const res = await owner.post(`/api/v1/inventory/ingredients${q}`).send({
      name: `bad-${tag}`,
      unit: 'PIECE',
      purchaseQuantity: 1,
      purchaseUnit: 'KG',
      purchasePrice: 50,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/convert/i);
  });

  it('rejects a purchase price without a quantity, and a yield of 0 or above 100', async () => {
    await owner
      .post(`/api/v1/inventory/ingredients${q}`)
      .send({ name: `half-${tag}`, unit: 'KG', purchasePrice: 50 })
      .expect(400);
    await owner
      .post(`/api/v1/inventory/ingredients${q}`)
      .send({ name: `y0-${tag}`, unit: 'KG', yieldPercent: 0 })
      .expect(400);
    await owner
      .post(`/api/v1/inventory/ingredients${q}`)
      .send({ name: `y101-${tag}`, unit: 'KG', yieldPercent: 101 })
      .expect(400);
  });

  it('values a purchased ingredient from the weighted average of goods receipts', async () => {
    id.cheeseRecipe = await menuItem('CheeseOnly');
    const res = await saveRecipe(id.cheeseRecipe, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.cheese, quantity: 100, unit: 'G' }],
    }).expect(200);
    expect(res.body.cost.costPerPortion).toBe(40); // 0.1 kg x ₹400
    expect(res.body.cost.recipeCost.lines[0].unitCost.source).toBe('AVERAGE');
  });

  // --- The spec's worked examples ---------------------------------------------------

  it('flour at ₹50/kg and 200 g in a recipe costs ₹10', async () => {
    id.pasta = await menuItem('Pasta', { price: 100 });
    const res = await saveRecipe(id.pasta, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.flour, quantity: 200, unit: 'G' }],
    }).expect(200);
    expect(res.body.cost.recipeCost.lines[0].lineCost).toBe(10);
    expect(res.body.cost.recipeCost.ingredientCost).toBe(10);
    expect(res.body.cost.costPerPortion).toBe(10);
  });

  it('a ₹600 batch making 20 portions costs ₹30 per portion, with yield counted once', async () => {
    id.biryani = await menuItem('Biryani', {
      price: 120,
      halfPrice: 70,
      taxRatePercent: 0,
    });
    // 4.8 kg usable rice at 80% yield = 6 kg bought = ₹600
    const res = await saveRecipe(id.biryani, {
      batchOutputQty: 20,
      targetMarginPercent: 60,
      targetMarkupPercent: 60,
      lines: [{ ingredientId: id.rice, quantity: 4.8, unit: 'KG' }],
    }).expect(200);
    const c = res.body.cost;
    expect(c.recipeCost.ingredientCost).toBe(600);
    expect(c.recipeCost.batchCost).toBe(600);
    expect(c.recipeCost.yieldLossCost).toBe(120); // shown separately, not added twice
    expect(c.costPerPortion).toBe(30);
    // 60% margin => ₹75, 60% markup => ₹48, both before sales tax
    expect(res.body.suggestions.margin.priceBeforeTax).toBe(75);
    expect(res.body.suggestions.markup.priceBeforeTax).toBe(48);
  });

  it('shows ingredient cost, batch cost, cost per portion and production cost for overheads', async () => {
    const res = await saveRecipe(id.biryani, {
      batchOutputQty: 20,
      overheads: [
        { kind: 'PACKAGING', amount: 2, basis: 'PER_PORTION' },
        { kind: 'LABOUR', amount: 100, basis: 'PER_BATCH' },
      ],
      lines: [{ ingredientId: id.rice, quantity: 4.8, unit: 'KG' }],
      baseVersion: (await view(id.biryani)).version,
    }).expect(200);
    const r = res.body.cost.recipeCost;
    expect(r.ingredientCost).toBe(600);
    expect(r.overheadCost).toBe(140);
    expect(r.batchCost).toBe(740);
    expect(res.body.cost.costPerPortion).toBe(37);
  });

  it('reports mixed compatible units, and refuses weight-to-volume without a conversion', async () => {
    id.omelette = await menuItem('Omelette');
    const ok = await saveRecipe(id.omelette, {
      batchOutputQty: 1,
      lines: [
        { ingredientId: id.oil, quantity: 250, unit: 'ML' },
        { ingredientId: id.onion, quantity: 1, unit: 'KG' },
        { ingredientId: id.egg, quantity: 0.25, unit: 'DOZEN' },
      ],
    }).expect(200);
    expect(ok.body.cost.costPerPortion).toBe(30 + 40 + 30); // 0.25 L oil, 1 kg onion, 3 eggs
    // oil has a 920 g/L conversion, so grams work; onion (KG) has none, so litres do not
    await saveRecipe(id.omelette, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.oil, quantity: 920, unit: 'G' }],
    }).expect(200);
    const bad = await saveRecipe(id.omelette, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.onion, quantity: 1, unit: 'L' }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/convert/i);
  });

  it('refuses zero/negative quantities and zero batch output', async () => {
    await saveRecipe(id.omelette, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.onion, quantity: 0 }],
    }).expect(400);
    await saveRecipe(id.omelette, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.onion, quantity: -2 }],
    }).expect(400);
    await saveRecipe(id.omelette, {
      batchOutputQty: 0,
      lines: [{ ingredientId: id.onion, quantity: 1 }],
    }).expect(400);
    await saveRecipe(id.omelette, {
      batchOutputQty: 1,
      lines: [
        { ingredientId: id.onion, quantity: 1 },
        { ingredientId: id.onion, quantity: 2 },
      ],
    }).expect(400);
  });

  it('flags an unpriced ingredient instead of understating the cost', async () => {
    const free = await ingredient('unpriced', { unit: 'KG' }, 10);
    const item = await menuItem('Unpriced');
    const res = await saveRecipe(item, {
      batchOutputQty: 1,
      lines: [
        { ingredientId: free, quantity: 100, unit: 'G' },
        { ingredientId: id.flour, quantity: 100, unit: 'G' },
      ],
    }).expect(200);
    expect(res.body.cost.complete).toBe(false);
    expect(res.body.cost.costPerPortion).toBeNull();
    expect(res.body.profitability).toBeNull();
    expect(res.body.cost.recipeCost.issues.map((i: any) => i.code)).toContain(
      'MISSING_PRICE',
    );
  });

  // --- Tax-aware profitability --------------------------------------------------------

  it('measures margin on revenue excluding tax (tax-inclusive price)', async () => {
    const item = await menuItem('Taxed', { price: 105, taxRatePercent: 5 });
    const res = await saveRecipe(item, {
      batchOutputQty: 1,
      targetMarginPercent: 60,
      lines: [{ ingredientId: id.flour, quantity: 600, unit: 'G' }],
    }).expect(200); // cost 30
    expect(res.body.taxMode).toBe('INCLUSIVE');
    expect(res.body.profitability.netRevenue).toBe(100);
    expect(res.body.profitability.taxAmount).toBe(5);
    expect(res.body.profitability.grossProfit).toBe(70);
    expect(res.body.profitability.foodCostPercent).toBe(30);
    expect(res.body.profitability.grossMarginPercent).toBe(70);
    expect(res.body.suggestions.margin.priceBeforeTax).toBe(75);
    expect(res.body.suggestions.margin.listedPrice).toBe(78.75); // 75 + 5% tax
  });

  // --- Prices are never changed automatically -----------------------------------------

  it('does not touch the selling price when a cost changes, and only applies it on request', async () => {
    const before = Number(
      (await owner.get(`/api/v1/menu/items/${id.pasta}${q}`).expect(200)).body
        .price,
    );
    await owner
      .patch(`/api/v1/inventory/ingredients/${id.flour}${q}`)
      .send({ purchasePrice: 500 })
      .expect(200); // ₹100/kg
    expect((await view(id.pasta)).cost.costPerPortion).toBe(20);
    expect(
      Number(
        (await owner.get(`/api/v1/menu/items/${id.pasta}${q}`).expect(200)).body
          .price,
      ),
    ).toBe(before);
    await owner
      .patch(`/api/v1/inventory/ingredients/${id.flour}${q}`)
      .send({ purchasePrice: 250 })
      .expect(200); // back to ₹50/kg

    // a stale suggestion is refused
    const stale = await owner
      .post(`/api/v1/costing/menu-items/${id.pasta}/apply-price${q}`)
      .send({ price: 150, expectedCurrentPrice: before + 1 });
    expect(stale.status).toBe(409);
    expect(
      Number(
        (await owner.get(`/api/v1/menu/items/${id.pasta}${q}`).expect(200)).body
          .price,
      ),
    ).toBe(before);
    // the owner applies it deliberately
    const ok = await owner
      .post(`/api/v1/costing/menu-items/${id.pasta}/apply-price${q}`)
      .send({ price: 150, expectedCurrentPrice: before })
      .expect(201);
    expect(ok.body.price).toBe(150);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'menu_item.price_applied', entityId: id.pasta },
    });
    expect(audit).not.toBeNull();
  });

  it('warns when an ingredient price rise erodes the margin, and clears it when acknowledged', async () => {
    const item = await menuItem('Erode', { price: 100 });
    await saveRecipe(item, {
      batchOutputQty: 1,
      alertDropPoints: 5,
      lines: [{ ingredientId: id.flour, quantity: 200, unit: 'G' }],
    }).expect(200); // cost 10, margin 90%
    expect((await view(item)).alert.level).toBe('OK');
    await owner
      .patch(`/api/v1/inventory/ingredients/${id.flour}${q}`)
      .send({ purchasePrice: 400 })
      .expect(200); // ₹80/kg => cost 16, margin 84%
    const after = await view(item);
    expect(after.alert.level).toBe('WATCH');
    expect(after.alert.dropPoints).toBe(6);
    const overview = (
      await owner.get(`/api/v1/costing/overview${q}`).expect(200)
    ).body;
    expect(overview.alerts.map((a: any) => a.menuItemId)).toContain(item);
    await owner
      .post(`/api/v1/costing/menu-items/${item}/acknowledge${q}`)
      .expect(201);
    expect((await view(item)).alert.level).toBe('OK');
    await owner
      .patch(`/api/v1/inventory/ingredients/${id.flour}${q}`)
      .send({ purchasePrice: 250 })
      .expect(200);
  });

  // --- Role restrictions ----------------------------------------------------------------

  it('keeps costs away from roles without inventory/financial access', async () => {
    await cashier.get(`/api/v1/costing/menu-items/${id.pasta}${q}`).expect(403);
    await cashier.get(`/api/v1/costing/overview${q}`).expect(403);
    await cashier.get(`/api/v1/costing/bundle${q}`).expect(403);
    await cashier
      .put(`/api/v1/costing/menu-items/${id.pasta}${q}`)
      .send({ batchOutputQty: 1, lines: [] })
      .expect(403);
    // the menu list is open to cashiers but must not carry the cost
    const list = (await cashier.get(`/api/v1/menu/items${q}`).expect(200))
      .body as any[];
    const mine = list.find((i) => i.id === id.pasta);
    expect(mine).toBeDefined();
    expect('costPrice' in mine).toBe(false);
    const asOwner = (await owner.get(`/api/v1/menu/items${q}`).expect(200))
      .body as any[];
    expect(asOwner.find((i) => i.id === id.pasta).costPrice).not.toBeNull();
  });

  it('lets an inventory manager see costs but not change the selling price', async () => {
    await invMgr.get(`/api/v1/costing/menu-items/${id.pasta}${q}`).expect(200);
    const price = (await view(id.pasta)).price;
    const res = await invMgr
      .post(`/api/v1/costing/menu-items/${id.pasta}/apply-price${q}`)
      .send({ price: 999, expectedCurrentPrice: price });
    expect(res.status).toBe(403);
    expect((await view(id.pasta)).price).toBe(price);
  });

  it('detects two people editing the same recipe', async () => {
    const v = (await view(id.pasta)).version;
    await saveRecipe(id.pasta, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.flour, quantity: 200, unit: 'G' }],
      baseVersion: v,
    }).expect(200);
    const stale = await saveRecipe(id.pasta, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.flour, quantity: 300, unit: 'G' }],
      baseVersion: v,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('COSTING_CONFLICT');
    expect(stale.body.current.lines[0].quantity).toBe(200); // the server's copy comes back
  });

  // --- Stock deduction at sale --------------------------------------------------------

  it('sells a batch recipe: deducts usable quantity grossed up by yield, scaled to one portion', async () => {
    // biryani: 4.8 kg usable rice / 20 portions = 0.24 kg usable = 0.3 kg raw per portion
    await saveRecipe(id.biryani, {
      batchOutputQty: 20,
      lines: [{ ingredientId: id.rice, quantity: 4.8, unit: 'KG' }],
      baseVersion: (await view(id.biryani)).version,
    }).expect(200);
    const before = await stockOf(id.rice);
    const order = await newOrder([{ menuItemId: id.biryani, quantity: 2 }]);
    await pay(order).expect(201);
    expect(await stockOf(id.rice)).toBeCloseTo(before - 0.6, 3);
    expect(Number(await frozenCost(order.items[0].id))).toBe(30); // cost per portion frozen at payment
  });

  it('a half portion uses half the stock and half the cost', async () => {
    const before = await stockOf(id.rice);
    const order = await newOrder([
      { menuItemId: id.biryani, quantity: 2, portion: 'HALF' },
    ]);
    await pay(order).expect(201);
    expect(await stockOf(id.rice)).toBeCloseTo(before - 0.3, 3); // 2 x 0.5 x 0.3
    expect(Number(await frozenCost(order.items[0].id))).toBe(15);
  });

  it("keeps a sold item's cost stable when ingredient prices later change", async () => {
    const order = await newOrder([{ menuItemId: id.pasta, quantity: 1 }]);
    await pay(order).expect(201);
    const frozen = Number(await frozenCost(order.items[0].id));
    expect(frozen).toBe(10);
    await owner
      .patch(`/api/v1/inventory/ingredients/${id.flour}${q}`)
      .send({ purchasePrice: 1000 })
      .expect(200);
    expect((await view(id.pasta)).cost.costPerPortion).toBe(40); // live cost moved
    expect(Number(await frozenCost(order.items[0].id))).toBe(frozen); // history did not
    await owner
      .patch(`/api/v1/inventory/ingredients/${id.flour}${q}`)
      .send({ purchasePrice: 250 })
      .expect(200);
  });

  it('keeps the frozen cost off every order response', async () => {
    const order = await newOrder([{ menuItemId: id.pasta, quantity: 1 }]);
    await pay(order).expect(201);
    const body = JSON.stringify(
      (await owner.get(`/api/v1/orders/${order.id}${q}`).expect(200)).body,
    );
    expect(body).not.toMatch(/unitCost|"cost"/);
  });

  it('options add and remove ingredients: extra cheese costs and consumes, no-onion saves both', async () => {
    id.plate = await menuItem('Plate', { price: 200 });
    await saveRecipe(id.plate, {
      batchOutputQty: 1,
      lines: [
        { ingredientId: id.flour, quantity: 200, unit: 'G' },
        { ingredientId: id.onion, quantity: 20, unit: 'G' },
      ],
    }).expect(200); // 10 + 0.8
    const grp = await owner
      .post(`/api/v1/menu/modifier-groups${q}`)
      .send({
        name: `Opts ${tag}`,
        minSelect: 0,
        maxSelect: 2,
        modifiers: [
          { name: 'Extra cheese', priceAdjustment: 30 },
          { name: 'No onion', priceAdjustment: 0 },
        ],
      })
      .expect(201);
    const mods = (
      await owner.get(`/api/v1/menu/modifier-groups${q}`).expect(200)
    ).body.find((g: any) => g.id === grp.body.id).modifiers;
    const cheeseMod = mods.find((m: any) => m.name === 'Extra cheese').id;
    const noOnion = mods.find((m: any) => m.name === 'No onion').id;
    await owner
      .patch(`/api/v1/menu/items/${id.plate}${q}`)
      .send({ modifierGroupIds: [grp.body.id] })
      .expect(200);
    await owner
      .put(`/api/v1/costing/modifiers/${cheeseMod}${q}`)
      .send({ lines: [{ ingredientId: id.cheese, quantity: 30, unit: 'G' }] })
      .expect(200);
    await owner
      .put(`/api/v1/costing/modifiers/${noOnion}${q}`)
      .send({ lines: [{ ingredientId: id.onion, quantity: -20, unit: 'G' }] })
      .expect(200);

    const v = await view(id.plate);
    expect(v.cost.costPerPortion).toBe(10.8);
    expect(v.modifiers.find((m: any) => m.name === 'Extra cheese').cost).toBe(
      12,
    );
    expect(v.modifiers.find((m: any) => m.name === 'No onion').cost).toBe(-0.8);

    const cheese0 = await stockOf(id.cheese);
    const onion0 = await stockOf(id.onion);
    const order = await newOrder([
      { menuItemId: id.plate, quantity: 1, modifierIds: [cheeseMod, noOnion] },
    ]);
    await pay(order).expect(201);
    expect(await stockOf(id.cheese)).toBeCloseTo(cheese0 - 0.03, 3);
    expect(await stockOf(id.onion)).toBeCloseTo(onion0, 3); // 20 g in the recipe, 20 g removed
    expect(Number(await frozenCost(order.items[0].id))).toBeCloseTo(10 + 12, 4); // 10.8 + 12 - 0.8
  });

  it('puts returned stock back in the same quantities, once', async () => {
    const order = await newOrder([
      { menuItemId: id.biryani, quantity: 2, portion: 'HALF' },
    ]);
    await pay(order).expect(201);
    const afterSale = await stockOf(id.rice);
    const refund = {
      amount: 10,
      method: 'CASH',
      returnedItems: [{ orderItemId: order.items[0].id, quantity: 2 }],
    };
    await owner
      .post(`/api/v1/orders/${order.id}/refund${q}`)
      .send(refund)
      .expect(201);
    expect(await stockOf(id.rice)).toBeCloseTo(afterSale + 0.3, 3);
    // a second return of the same units is refused, so stock cannot be inflated
    await owner
      .post(`/api/v1/orders/${order.id}/refund${q}`)
      .send(refund)
      .expect(400);
    expect(await stockOf(id.rice)).toBeCloseTo(afterSale + 0.3, 3);
  });

  // --- Preparations and prepared batches ----------------------------------------------

  it('prices a nested preparation and refuses circular ones', async () => {
    const sauce = await owner
      .post(`/api/v1/costing/preparations${q}`)
      .send({
        name: `Sauce-${tag}`,
        unit: 'KG',
        batchOutputQty: 2,
        lines: [
          { ingredientId: id.onion, quantity: 2, unit: 'KG' },
          { ingredientId: id.oil, quantity: 0.5, unit: 'L' },
        ],
      })
      .expect(201);
    id.sauce = sauce.body.id;
    expect(sauce.body.cost.batchCost).toBe(140); // 80 + 60
    expect(sauce.body.cost.costPerPortion).toBe(70); // per kg

    const base = await owner
      .post(`/api/v1/costing/preparations${q}`)
      .send({
        name: `Base-${tag}`,
        unit: 'KG',
        batchOutputQty: 1,
        lines: [
          { ingredientId: id.sauce, quantity: 500, unit: 'G' },
          { ingredientId: id.flour, quantity: 100, unit: 'G' },
        ],
      })
      .expect(201);
    id.base = base.body.id;
    expect(base.body.cost.batchCost).toBe(40); // 0.5 kg sauce @70 + 0.1 kg flour @50 = 35 + 5

    // sauce <- base <- sauce would loop
    const loop = await owner
      .put(`/api/v1/costing/preparations/${id.sauce}${q}`)
      .send({
        name: `Sauce-${tag}`,
        unit: 'KG',
        batchOutputQty: 2,
        lines: [{ ingredientId: id.base, quantity: 1, unit: 'KG' }],
        baseVersion: sauce.body.version,
      });
    expect(loop.status).toBe(400);
    expect(loop.body.message).toMatch(/itself/);
    const self = await owner
      .put(`/api/v1/costing/preparations/${id.sauce}${q}`)
      .send({
        name: `Sauce-${tag}`,
        unit: 'KG',
        batchOutputQty: 2,
        lines: [{ ingredientId: id.sauce, quantity: 1, unit: 'KG' }],
        baseVersion: sauce.body.version,
      });
    expect(self.status).toBe(400);

    // a dish using the sauce is costed through it
    id.pizza = await menuItem('Pizza');
    const dish = await saveRecipe(id.pizza, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.sauce, quantity: 300, unit: 'G' }],
    }).expect(200);
    expect(dish.body.cost.costPerPortion).toBe(21); // 0.3 kg x 70
  });

  it('a prepared batch consumes raw stock at production and finished stock at sale - never both', async () => {
    const prep = await owner
      .post(`/api/v1/costing/preparations${q}`)
      .send({
        name: `Curry-${tag}`,
        unit: 'PIECE',
        batchOutputQty: 20,
        overheads: [{ kind: 'LABOUR', amount: 100, basis: 'PER_BATCH' }],
        lines: [
          { ingredientId: id.onion, quantity: 5, unit: 'KG' },
          { ingredientId: id.flour, quantity: 2, unit: 'KG' },
        ],
      })
      .expect(201);
    id.curry = prep.body.id;
    expect(prep.body.cost.costPerPortion).toBe(20); // (200 + 100 + 100) / 20

    // the dish sells finished stock; it must not also list raw ingredients
    id.curryDish = await menuItem('CurryDish', { price: 80 });
    await owner
      .patch(`/api/v1/inventory/menu-items/${id.curryDish}/tracking${q}`)
      .send({
        inventoryTracking: 'DIRECT',
        stockIngredientId: id.curry,
        stockQuantityPerSale: 1,
      })
      .expect(200);
    const withLines = await saveRecipe(id.curryDish, {
      batchOutputQty: 1,
      lines: [{ ingredientId: id.flour, quantity: 100, unit: 'G' }],
    });
    expect(withLines.status).toBe(400);
    const dv = await view(id.curryDish);
    expect(dv.cost.source).toBe('STOCK_ITEM');
    expect(dv.cost.costPerPortion).toBe(20);

    const onion0 = await stockOf(id.onion);
    const flour0 = await stockOf(id.flour);
    const key = randomUUID();
    const run = await owner
      .post(`/api/v1/costing/preparations/${id.curry}/produce${q}`)
      .send({ idempotencyKey: key, batches: 1 })
      .expect(201);
    expect(run.body.duplicate).toBe(false);
    expect(run.body.run.outputQty).toBe(20);
    expect(run.body.run.ingredientCost).toBe(300); // onion 5 kg @40 + flour 2 kg @50
    expect(run.body.run.totalCost).toBe(400); // + ₹100 labour
    expect(run.body.run.unitCost).toBe(20);
    expect(await stockOf(id.curry)).toBe(20);
    expect(await stockOf(id.onion)).toBeCloseTo(onion0 - 5, 3);
    expect(await stockOf(id.flour)).toBeCloseTo(flour0 - 2, 3);

    // the same run sent again (retry or offline sync) is recognised, not repeated
    const again = await owner
      .post(`/api/v1/costing/preparations/${id.curry}/produce${q}`)
      .send({ idempotencyKey: key, batches: 1 })
      .expect(201);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.run.id).toBe(run.body.run.id);
    expect(await stockOf(id.curry)).toBe(20);
    expect(await stockOf(id.onion)).toBeCloseTo(onion0 - 5, 3);
    const parallel = await Promise.all(
      [1, 2, 3].map(() =>
        owner
          .post(`/api/v1/costing/preparations/${id.curry}/produce${q}`)
          .send({ idempotencyKey: randomUUID(), batches: 0.5 }),
      ),
    );
    expect(parallel.every((r) => r.status === 201)).toBe(true);
    expect(await stockOf(id.curry)).toBe(20 + 30);

    // selling takes finished stock only
    const onion1 = await stockOf(id.onion);
    const flour1 = await stockOf(id.flour);
    const order = await newOrder([{ menuItemId: id.curryDish, quantity: 3 }]);
    await pay(order).expect(201);
    expect(await stockOf(id.curry)).toBe(47);
    expect(await stockOf(id.onion)).toBeCloseTo(onion1, 3);
    expect(await stockOf(id.flour)).toBeCloseTo(flour1, 3);
    expect(Number(await frozenCost(order.items[0].id))).toBe(20);

    // a returned plate goes back to finished stock
    await owner
      .post(`/api/v1/orders/${order.id}/refund${q}`)
      .send({
        amount: 80,
        method: 'CASH',
        returnedItems: [{ orderItemId: order.items[0].id, quantity: 1 }],
      })
      .expect(201);
    expect(await stockOf(id.curry)).toBe(48);
  });

  it('refuses to delete or retype a preparation that is in use', async () => {
    await owner
      .delete(`/api/v1/costing/preparations/${id.sauce}${q}`)
      .expect(400);
    const p = (
      await owner
        .get(`/api/v1/costing/preparations/${id.sauce}${q}`)
        .expect(200)
    ).body;
    const res = await owner
      .put(`/api/v1/costing/preparations/${id.sauce}${q}`)
      .send({
        name: p.name,
        unit: 'L',
        batchOutputQty: 2,
        lines: [{ ingredientId: id.onion, quantity: 2, unit: 'KG' }],
        baseVersion: p.version,
      });
    expect(res.status).toBe(400);
  });

  // --- Offline bundle -----------------------------------------------------------------

  it('serves the phone a bundle that yields the same cost as the server', async () => {
    const b = (await owner.get(`/api/v1/costing/bundle${q}`).expect(200)).body;
    expect(b.taxMode).toBe('INCLUSIVE');
    const item = b.items.find((i: any) => i.menuItemId === id.biryani);
    expect(item.batchOutputQty).toBe(20);
    expect(item.lines[0].quantity).toBe(4.8);
    expect(b.ingredients.find((i: any) => i.id === id.rice).yieldPercent).toBe(
      80,
    );
    expect(b.ingredients.find((i: any) => i.id === id.curry).kind).toBe(
      'PREPARED',
    );
  });

  it('existing recipe endpoints still work for plain recipes and now reject raw lines on stock items', async () => {
    const simple = await menuItem('LegacyStyle');
    const res = await owner
      .patch(`/api/v1/inventory/menu-items/${simple}/recipe${q}`)
      .send({ lines: [{ ingredientId: id.flour, quantity: 0.2 }] })
      .expect(200);
    expect(res.body.totalCost).toBe(10);
    await owner
      .patch(`/api/v1/inventory/menu-items/${id.curryDish}/recipe${q}`)
      .send({ lines: [{ ingredientId: id.flour, quantity: 1 }] })
      .expect(400);
  });
});
