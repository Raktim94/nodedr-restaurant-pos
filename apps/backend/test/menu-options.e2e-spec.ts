/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped by design */
// Per-item options (size, extras): editing a group in place, removing options that past orders used, and keeping removed
// options from being offered or ordered. Opt-in:
//   MENUOPT_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand menu-options
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.MENUOPT_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);
const q = '?branchId=demo-branch';

run('Menu item options (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let waiter: ReturnType<typeof request.agent>;
  let itemId: string;
  let groupId: string;
  let regular: string;
  let large: string;
  let orderId: string;

  const mkGroup = async (
    name: string,
    modifiers: object[],
    extra: object = {},
  ) =>
    (
      await owner
        .post(`/api/v1/menu/modifier-groups${q}`)
        .send({
          name,
          minSelect: 0,
          maxSelect: 1,
          isRequired: false,
          modifiers,
          ...extra,
        })
        .expect(201)
    ).body;
  const items = async () =>
    (await owner.get(`/api/v1/menu/items${q}`).expect(200)).body as {
      id: string;
      modifierGroups: {
        modifierGroup: {
          id: string;
          modifiers: { id: string; name: string; priceAdjustment: string }[];
        };
      }[];
    }[];
  const orderWith = (modifierIds: string[]) =>
    owner.post(`/api/v1/orders${q}`).send({
      type: 'TAKEAWAY',
      items: [{ menuItemId: itemId, quantity: 1, modifierIds }],
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
    const email = `wtr-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: 'w',
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === 'WAITER')!.id,
        branchIds: ['demo-branch'],
      })
      .expect(201);
    waiter = request.agent(app.getHttpServer());
    await waiter
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);
    const cat = (await owner.get(`/api/v1/menu/categories${q}`).expect(200))
      .body[0].id as string;
    itemId = (
      await owner
        .post(`/api/v1/menu/items${q}`)
        .send({
          categoryId: cat,
          name: `Margherita ${tag}`,
          price: 300,
          taxRatePercent: 0,
        })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => app.close());

  it('creates a group with options and attaches it to the item; the item lists them in order with their prices', async () => {
    const g = await mkGroup(
      'Size',
      [
        { name: 'Regular', priceAdjustment: 0, isDefault: true },
        { name: 'Large', priceAdjustment: 100 },
      ],
      { isRequired: true },
    );
    groupId = g.id;
    regular = g.modifiers.find(
      (m: { name: string }) => m.name === 'Regular',
    ).id;
    large = g.modifiers.find((m: { name: string }) => m.name === 'Large').id;
    await owner
      .patch(`/api/v1/menu/items/${itemId}${q}`)
      .send({ modifierGroupIds: [groupId] })
      .expect(200);
    const me = (await items()).find((i) => i.id === itemId)!;
    expect(
      me.modifierGroups[0].modifierGroup.modifiers.map((m) => m.name),
    ).toEqual(['Regular', 'Large']);
    const listed = (
      await owner.get(`/api/v1/menu/modifier-groups${q}`).expect(200)
    ).body.find((x: { id: string }) => x.id === groupId);
    expect(listed._count.menuItems).toBe(1);
  });

  it('options are priced into the order and stay on the order as written', async () => {
    const res = await orderWith([large]).expect(201);
    orderId = res.body.id;
    expect(Number(res.body.totalAmount)).toBe(400);
    expect(
      res.body.items[0].modifiers.map(
        (m: { nameSnapshot: string }) => m.nameSnapshot,
      ),
    ).toEqual(['Large']);
  });

  it('a required option must be chosen, and an option of another item cannot be sent', async () => {
    const other = await mkGroup(`Other ${tag}`, [
      { name: 'Foreign', priceAdjustment: 5 },
    ]);
    const foreign = other.modifiers[0].id;
    expect((await orderWith([foreign])).status).toBe(400);
    await prisma.modifierGroup.delete({ where: { id: other.id } });
  });

  it('editing a group whose option was already ordered works (it used to fail), keeps ids, hides the removed option and keeps history', async () => {
    const res = await owner
      .patch(`/api/v1/menu/modifier-groups/${groupId}${q}`)
      .send({
        modifiers: [
          { id: regular, name: 'Small', priceAdjustment: 0, isDefault: true },
          { name: 'Extra large', priceAdjustment: 150 },
        ],
      });
    expect(res.status).toBe(200);
    const names = res.body.modifiers.map((m: { name: string }) => m.name);
    expect(names).toEqual(['Small', 'Extra large']);
    expect(res.body.modifiers[0].id).toBe(regular); // renamed in place, same option
    // "Large" was ordered before, so it is hidden, not deleted.
    const row = await prisma.modifier.findUniqueOrThrow({
      where: { id: large },
    });
    expect(row.isActive).toBe(false);
    // The past order is untouched.
    const past = (await owner.get(`/api/v1/orders/${orderId}${q}`).expect(200))
      .body;
    expect(past.items[0].modifiers[0]).toEqual(
      expect.objectContaining({ nameSnapshot: 'Large' }),
    );
    expect(Number(past.items[0].modifiers[0].priceAdjSnapshot)).toBe(100);
    // Nobody can pick it any more, on the menu or in an order.
    const me = (await items()).find((i) => i.id === itemId)!;
    expect(
      me.modifierGroups[0].modifierGroup.modifiers.map((m) => m.name),
    ).toEqual(['Small', 'Extra large']);
    const invalid = await orderWith([large]);
    expect(invalid.status).toBe(400);
  });

  it('the guest menu shows only current options', async () => {
    const floors = (await owner.get(`/api/v1/tables/floors${q}`).expect(200))
      .body as { id: string }[];
    const t = (
      await owner
        .post(`/api/v1/tables${q}`)
        .send({ floorId: floors[0].id, number: `O${tag}`, capacity: 2 })
        .expect(201)
    ).body;
    const qr = (
      await owner.post(`/api/v1/tables/${t.id}/qr-token${q}`).expect(201)
    ).body.qrToken;
    const menu = (
      await request(app.getHttpServer())
        .get(`/api/v1/public/menu/${qr}`)
        .expect(200)
    ).body;
    const item = menu.categories
      .flatMap((c: { items: { id: string }[] }) => c.items)
      .find((i: { id: string }) => i.id === itemId);
    const opts = item.modifierGroups[0].modifierGroup.modifiers.map(
      (m: { name: string }) => m.name,
    );
    expect(opts).toEqual(['Small', 'Extra large']);
    await prisma.table.delete({ where: { id: t.id } });
  });

  it('an option nobody ever ordered is really removed', async () => {
    const withTemp = (
      await owner
        .patch(`/api/v1/menu/modifier-groups/${groupId}${q}`)
        .send({
          modifiers: [
            { id: regular, name: 'Small', priceAdjustment: 0 },
            { name: 'Temp', priceAdjustment: 1 },
          ],
        })
        .expect(200)
    ).body;
    const temp = withTemp.modifiers.find(
      (m: { name: string }) => m.name === 'Temp',
    ).id;
    await owner
      .patch(`/api/v1/menu/modifier-groups/${groupId}${q}`)
      .send({ modifiers: [{ id: regular, name: 'Small', priceAdjustment: 0 }] })
      .expect(200);
    expect(
      await prisma.modifier.findUnique({ where: { id: temp } }),
    ).toBeNull();
  });

  it('options keep their stock links when the group is edited', async () => {
    const ing = await prisma.ingredient.create({
      data: {
        branchId: 'demo-branch',
        name: `Cheese ${tag}`,
        unit: 'KG',
      } as never,
    });
    await prisma.modifierIngredient.create({
      data: { modifierId: regular, ingredientId: ing.id, quantity: 0.05 },
    });
    await owner
      .patch(`/api/v1/menu/modifier-groups/${groupId}${q}`)
      .send({ modifiers: [{ id: regular, name: 'Small', priceAdjustment: 0 }] })
      .expect(200);
    expect(
      await prisma.modifierIngredient.count({ where: { modifierId: regular } }),
    ).toBe(1);
    await prisma.modifierIngredient.deleteMany({
      where: { modifierId: regular },
    });
    await prisma.ingredient.delete({ where: { id: ing.id } });
  });

  it('rejects a group edit that names an option of another group, or an impossible choose-count', async () => {
    const other = await mkGroup(
      `Extras ${tag}`,
      [{ name: 'Cheese', priceAdjustment: 40 }],
      { maxSelect: 3 },
    );
    const theirs = other.modifiers[0].id;
    expect(
      (
        await owner.patch(`/api/v1/menu/modifier-groups/${groupId}${q}`).send({
          modifiers: [{ id: theirs, name: 'Steal', priceAdjustment: 0 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await prisma.modifier.findUniqueOrThrow({ where: { id: theirs } })).name,
    ).toBe('Cheese');
    const bad = await owner
      .patch(`/api/v1/menu/modifier-groups/${other.id}${q}`)
      .send({ isRequired: true, minSelect: 3, maxSelect: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/cannot be less/);
    await prisma.modifierGroup.delete({ where: { id: other.id } });
  });

  it('a group that was ordered is kept (clear message); an unused one can be deleted; staff without menu.manage cannot edit', async () => {
    const del = await owner.delete(
      `/api/v1/menu/modifier-groups/${groupId}${q}`,
    );
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/ordered before/);
    const spare = await mkGroup(`Spare ${tag}`, [
      { name: 'A', priceAdjustment: 0 },
    ]);
    await owner
      .delete(`/api/v1/menu/modifier-groups/${spare.id}${q}`)
      .expect(200);
    expect(
      (
        await waiter
          .patch(`/api/v1/menu/modifier-groups/${groupId}${q}`)
          .send({ name: 'Hacked' })
      ).status,
    ).toBe(403);
    expect(
      (
        await waiter
          .post(`/api/v1/menu/modifier-groups${q}`)
          .send({ name: 'X', modifiers: [] })
      ).status,
    ).toBe(403);
  });
});
