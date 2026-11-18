/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Stock journal workflow: recipes per product, restricted roles, posted vouchers, missing cost, unit mismatch.
//   JOURNAL_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand stock-journal-workflow
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

const run = process.env.JOURNAL_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 5);
type Agent = ReturnType<typeof request.agent>;

run('Stock journal workflow (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Agent;
  let kitchen: Agent; // KITCHEN_STAFF: production.record + production.post
  let recordOnly: Agent; // custom role: production.record only (may draft, may not post)
  let invMgr: Agent; // INVENTORY_MANAGER: no menu.manage
  let cashier: Agent;
  const id: Record<string, string> = {};
  const E = '/api/v1/inventory';

  const item = async (name: string, unit: string, extra: object = {}) =>
    (
      await owner
        .post(`${E}/ingredients${q}`)
        .send({ name: `${name}-${tag}`, unit, ...extra })
        .expect(201)
    ).body.id as string;
  const stock = async (i: string) =>
    Number(
      (await owner.get(`${E}/ingredients/${i}${q}`).expect(200)).body
        .currentStock,
    );
  const receive = (
    ingredientId: string,
    quantity: string,
    unit: string,
    unitCost?: string,
  ) =>
    owner
      .post(`${E}/journal/receipts${q}`)
      .send({ ingredientId, quantity, unit, unitCost });
  const voucher = (over: Record<string, unknown> = {}) => ({
    inputs: [{ ingredientId: id.flour, quantity: '2', unit: 'KG' }],
    outputs: [{ ingredientId: id.bread, quantity: '20', unit: 'PIECE' }],
    ...over,
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
    owner = request.agent(app.getHttpServer());
    await owner
      .post('/api/v1/auth/login')
      .send({ email: 'owner@demo.local', password: 'Password123!' })
      .expect(201);
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const recRole = (
      await owner
        .post('/api/v1/roles')
        .send({
          name: `REC_${tag}`.toUpperCase(),
          label: 'Record only',
          permissionKeys: ['production.record'],
        })
        .expect(201)
    ).body as { id: string };
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
    const roleId = (n: string) => roles.find((r) => r.name === n)!.id;
    kitchen = await mk(roleId('KITCHEN_STAFF'), 'kitchen');
    invMgr = await mk(roleId('INVENTORY_MANAGER'), 'invmgr');
    cashier = await mk(roleId('CASHIER'), 'cashier');
    recordOnly = await mk(recRole.id, 'reconly');

    id.flour = await item('Flour', 'KG');
    id.salt = await item('Salt', 'KG');
    id.bread = await item('Bread', 'PIECE', { kind: 'PREPARED' });
    id.cake = await item('Cake', 'PIECE', { kind: 'PREPARED' }); // never gets a recipe
    await receive(id.flour, '100', 'KG', '40').expect(201);
    await receive(id.salt, '10', 'KG').expect(201); // received WITHOUT a cost
  });
  afterAll(async () => app.close());

  describe('recipes belong to one product', () => {
    it('an inventory manager saves a recipe; another product still has none', async () => {
      const r = await invMgr
        .post(`${E}/recipes${q}`)
        .send({
          outputIngredientId: id.bread,
          name: `Bread ${tag}`,
          baseOutputQty: '10',
          lines: [{ ingredientId: id.flour, quantity: '1', unit: 'KG' }],
        })
        .expect(201);
      id.recipe = r.body.id;
      const forBread = (
        await owner.get(`${E}/recipes${q}&productId=${id.bread}`).expect(200)
      ).body;
      expect(forBread.map((x: { id: string }) => x.id)).toContain(id.recipe);
      const forCake = (
        await owner.get(`${E}/recipes${q}&productId=${id.cake}`).expect(200)
      ).body;
      expect(forCake).toEqual([]); // genuinely empty for this product
    });

    it('saving a recipe changed no stock', async () => {
      expect(await stock(id.flour)).toBe(100);
      expect(await stock(id.bread)).toBe(0);
    });

    it('"fill from recipe" scales to the planned quantity and keeps units', async () => {
      const f = (
        await kitchen
          .get(`${E}/recipes/fill${q}&kind=RECIPE&id=${id.recipe}&quantity=50`)
          .expect(200)
      ).body;
      expect(f.plannedOutput).toBe('50');
      expect(f.lines).toHaveLength(1);
      expect(Number(f.lines[0].quantity)).toBe(5); // 1 kg per 10 pieces x 50
      expect(f.lines[0].unit).toBe('KG');
      expect(f.lines[0].ingredientId).toBe(id.flour);
    });

    it('a filled voucher with edited actual quantities posts with the recipe snapshot', async () => {
      const r = await kitchen
        .post(`${E}/production${q}`)
        .send(
          voucher({
            inputs: [
              {
                ingredientId: id.flour,
                quantity: '5.5',
                unit: 'KG',
                expectedQuantity: '5',
              },
            ],
            outputs: [
              { ingredientId: id.bread, quantity: '50', unit: 'PIECE' },
            ],
            recipe: { kind: 'RECIPE', id: id.recipe },
            post: true,
            idempotencyKey: `wf-fill-${tag}`,
          }),
        )
        .expect(201);
      expect(r.body.status).toBe('POSTED');
      expect(r.body.recipeName).toContain(`Bread ${tag}`);
      expect(await stock(id.flour)).toBe(94.5);
      expect(await stock(id.bread)).toBe(50);
    });
  });

  describe('permissions (server side)', () => {
    it('a cashier cannot read recipes, draft, or post', async () => {
      expect(
        (await cashier.get(`${E}/recipes${q}&productId=${id.bread}`)).status,
      ).toBe(403);
      expect(
        (
          await cashier
            .post(`${E}/production${q}`)
            .send(voucher({ post: false }))
        ).status,
      ).toBe(403);
      expect(
        (
          await cashier
            .post(`${E}/production${q}`)
            .send(voucher({ post: true }))
        ).status,
      ).toBe(403);
    });
    it('kitchen staff may read recipes, but not create/edit recipes or inventory items', async () => {
      expect(
        (await kitchen.get(`${E}/recipes${q}&productId=${id.bread}`)).status,
      ).toBe(200);
      expect(
        (
          await kitchen.post(`${E}/recipes${q}`).send({
            outputIngredientId: id.bread,
            name: 'x',
            baseOutputQty: '1',
            lines: [{ ingredientId: id.flour, quantity: '1', unit: 'KG' }],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await kitchen
            .patch(`${E}/recipes/${id.recipe}${q}`)
            .send({ name: 'y' })
        ).status,
      ).toBe(403);
      expect(
        (
          await kitchen
            .post(`${E}/ingredients${q}`)
            .send({ name: `Nope-${tag}`, unit: 'KG' })
        ).status,
      ).toBe(403);
    });
    it('an inventory manager may add inventory items but not menu items', async () => {
      expect(
        (
          await invMgr
            .post(`${E}/ingredients${q}`)
            .send({ name: `Mgr item ${tag}`, unit: 'KG' })
        ).status,
      ).toBe(201);
      const cat = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
        .body[0].id;
      expect(
        (
          await invMgr.post(`/api/v1/menu/items${q}`).send({
            categoryId: cat,
            name: `Nope ${tag}`,
            price: 10,
            taxRatePercent: 0,
          })
        ).status,
      ).toBe(403);
    });
    it('a record-only user may save a draft but cannot post it, and a draft moved no stock', async () => {
      const before = await stock(id.flour);
      const d = await recordOnly
        .post(`${E}/production${q}`)
        .send(voucher({ post: false, idempotencyKey: `wf-rec-${tag}` }))
        .expect(201);
      expect(d.body.status).toBe('DRAFT');
      id.draft = d.body.id;
      expect(await stock(id.flour)).toBe(before);
      expect(
        (await recordOnly.post(`${E}/production/${id.draft}/post${q}`).send({}))
          .status,
      ).toBe(403);
      expect(
        (
          await recordOnly
            .post(`${E}/production${q}`)
            .send(voucher({ post: true, idempotencyKey: `wf-rec2-${tag}` }))
        ).status,
      ).toBe(403);
      expect(await stock(id.flour)).toBe(before);
    });
    it('the record-only user can edit and delete a draft; someone with post permission posts it once', async () => {
      await recordOnly
        .patch(`${E}/production/${id.draft}${q}`)
        .send(
          voucher({
            inputs: [{ ingredientId: id.flour, quantity: '3', unit: 'KG' }],
          }),
        )
        .expect(200);
      const before = await stock(id.flour);
      await kitchen
        .post(`${E}/production/${id.draft}/post${q}`)
        .send({})
        .expect(201);
      expect(await stock(id.flour)).toBe(before - 3);
      expect(
        (await kitchen.post(`${E}/production/${id.draft}/post${q}`).send({}))
          .status,
      ).toBe(409);
      expect(await stock(id.flour)).toBe(before - 3);
    });
  });

  describe('a posted voucher is never rewritten', () => {
    it('edit and delete of a posted voucher are refused with a clear reason, even with a valid body', async () => {
      const edit = await owner
        .patch(`${E}/production/${id.draft}${q}`)
        .send(voucher());
      expect(edit.status).toBe(400);
      expect(edit.body.message).toMatch(/Only a draft can be edited/);
      const del = await owner.delete(`${E}/production/${id.draft}${q}`);
      expect(del.status).toBe(400);
      expect(del.body.message).toMatch(/Only a draft can be deleted/);
    });
    it('kitchen staff cannot correct or reverse', async () => {
      expect(
        (
          await kitchen
            .post(`${E}/production/${id.draft}/correct${q}`)
            .send({ ...voucher(), reason: 'x' })
        ).status,
      ).toBe(403);
      expect(
        (
          await kitchen
            .post(`${E}/production/${id.draft}/void${q}`)
            .send({ reason: 'x' })
        ).status,
      ).toBe(403);
    });
    it('a correction needs a reason and a valid voucher; a failed one changes nothing', async () => {
      const f0 = await stock(id.flour);
      expect(
        (
          await owner
            .post(`${E}/production/${id.draft}/correct${q}`)
            .send({ ...voucher() })
        ).status,
      ).toBe(400); // no reason
      expect(
        (
          await owner.post(`${E}/production/${id.draft}/correct${q}`).send({
            ...voucher({
              inputs: [
                { ingredientId: id.flour, quantity: '99999', unit: 'KG' },
              ],
            }),
            reason: 'too much',
          })
        ).status,
      ).toBe(400); // shortage rolls everything back
      expect(await stock(id.flour)).toBe(f0);
      expect(
        (await owner.get(`${E}/production/${id.draft}${q}`).expect(200)).body
          .status,
      ).toBe('POSTED');
    });
    it('a valid correction reverses the old entry, posts a replacement, links both, and keeps the history', async () => {
      const f0 = await stock(id.flour);
      const b0 = await stock(id.bread);
      const c = await owner
        .post(`${E}/production/${id.draft}/correct${q}`)
        .send({
          ...voucher({
            inputs: [{ ingredientId: id.flour, quantity: '1', unit: 'KG' }],
            outputs: [
              { ingredientId: id.bread, quantity: '10', unit: 'PIECE' },
            ],
          }),
          reason: 'miscounted',
        })
        .expect(201);
      expect(c.body.status).toBe('POSTED');
      expect(c.body.correctsEntry.id).toBe(id.draft);
      const old = (
        await owner.get(`${E}/production/${id.draft}${q}`).expect(200)
      ).body;
      expect(old.status).toBe('VOIDED');
      expect(old.correctedBy[0].id).toBe(c.body.id);
      expect(old.voidReason).toMatch(/miscounted/);
      // old entry used 3 kg and made 20: net after = old reversed (+3 flour, -20 bread) then new (-1 flour, +10 bread)
      expect(await stock(id.flour)).toBe(f0 + 3 - 1);
      expect(await stock(id.bread)).toBe(b0 - 20 + 10);
      const ledger = (
        await owner.get(`${E}/journal${q}&type=REVERSAL`).expect(200)
      ).body.items;
      expect(
        ledger.some(
          (m: { productionEntryId: string }) =>
            m.productionEntryId === id.draft,
        ),
      ).toBe(true);
    });
  });

  describe('costing and units', () => {
    beforeAll(async () => {
      await owner
        .patch(`${E}/manufacturing/settings${q}`)
        .send({ enabled: true })
        .expect(200);
    });
    it('an ingredient with no cost blocks posting; nothing is invented and nothing moves', async () => {
      const body = voucher({
        inputs: [{ ingredientId: id.salt, quantity: '1', unit: 'KG' }],
        costing: { enabled: true, costs: [] },
      });
      const pv = (
        await kitchen
          .post(`${E}/production/voucher-preview${q}`)
          .send(body)
          .expect(201)
      ).body;
      expect(pv.costError).toMatch(/No cost yet for/);
      expect(pv.costError).toMatch(/Type a rate or receive it with a cost/);
      const before = await stock(id.salt);
      const r = await kitchen
        .post(`${E}/production${q}`)
        .send({ ...body, post: true });
      expect(r.status).toBe(400);
      expect(await stock(id.salt)).toBe(before);
    });
    it('typing a rate resolves it; so does receiving the item with a cost', async () => {
      const typed = voucher({
        inputs: [
          { ingredientId: id.salt, quantity: '1', unit: 'KG', rate: '12' },
        ],
        costing: { enabled: true, costs: [] },
      });
      const pv = (
        await kitchen
          .post(`${E}/production/voucher-preview${q}`)
          .send(typed)
          .expect(201)
      ).body;
      expect(pv.costError).toBeNull();
      await receive(id.salt, '5', 'KG', '15').expect(201);
      const untyped = voucher({
        inputs: [{ ingredientId: id.salt, quantity: '1', unit: 'KG' }],
        costing: { enabled: true, costs: [] },
      });
      expect(
        (
          await kitchen
            .post(`${E}/production/voucher-preview${q}`)
            .send(untyped)
            .expect(201)
        ).body.costError,
      ).toBeNull();
    });
    it('an incompatible unit is refused with a readable message and moves nothing', async () => {
      const before = await stock(id.flour);
      const r = await kitchen.post(`${E}/production${q}`).send(
        voucher({
          inputs: [{ ingredientId: id.flour, quantity: '1', unit: 'L' }],
          post: true,
        }),
      );
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/is stocked in KG; L cannot be converted/);
      expect(await stock(id.flour)).toBe(before);
    });
    it('insufficient stock refuses the whole voucher', async () => {
      const before = await stock(id.flour);
      const r = await kitchen.post(`${E}/production${q}`).send(
        voucher({
          inputs: [{ ingredientId: id.flour, quantity: '100000', unit: 'KG' }],
          post: true,
        }),
      );
      expect(r.status).toBe(400);
      expect(await stock(id.flour)).toBe(before);
    });
  });

  describe('posted report', () => {
    it('lists posted vouchers and never a draft', async () => {
      const d = await owner
        .post(`${E}/production${q}`)
        .send(
          voucher({
            post: false,
            idempotencyKey: `wf-d-${tag}`,
            batchRef: `DRAFT-${tag}`,
          }),
        )
        .expect(201);
      const daily = JSON.stringify(
        (await owner.get(`${E}/manufacturing/daily${q}`).expect(200)).body,
      );
      expect(daily).not.toContain(d.body.entryNo);
      const posted = (
        await owner.get(`${E}/production${q}&status=POSTED`).expect(200)
      ).body as { status: string }[];
      expect(posted.every((e) => e.status === 'POSTED')).toBe(true);
      await owner.delete(`${E}/production/${d.body.id}${q}`).expect(200);
    });
  });
});
