/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped by design */
// Bulk CSV import of menu items and ingredients, end to end.
//   IMPORTS_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand imports
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

process.env.ALLOW_PUBLIC_SIGNUP = 'true'; // creates a second restaurant
const run = process.env.IMPORTS_E2E ? describe : describe.skip;
const BRANCH = 'demo-branch';
const q = `branchId=${BRANCH}`;
const tag = randomUUID().slice(0, 6).toUpperCase();
const I = '/api/v1/imports';
type Agent = ReturnType<typeof request.agent>;

const MENU_HEAD =
  'name,category,price,half_price,tax_rate_percent,sku,description,station,is_veg,spice_level,allergens,available_from,available_to,is_active';
const menuCsv = (rows: string[]) => [MENU_HEAD, ...rows].join('\r\n') + '\r\n';
const ING_HEAD =
  'name,unit,sku,reorder_level,cost_per_unit,opening_stock,is_active';
const ingCsv = (rows: string[]) => [ING_HEAD, ...rows].join('\r\n') + '\r\n';

run('Bulk CSV import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: Agent;
  let manager: Agent;
  let cashier: Agent;
  let other: Agent;

  const send = (
    a: Agent,
    kind: string,
    step: 'preview' | 'commit',
    csv: string | Buffer,
    query = '',
    name = 'import.csv',
  ) =>
    a
      .post(`${I}/${kind}/${step}?${q}${query}`)
      .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv), name);

  const mkUser = async (label: string, role: string) => {
    const roles = (await owner.get('/api/v1/users/roles').expect(200)).body as {
      id: string;
      name: string;
    }[];
    const email = `imp-${label}-${tag}@demo.local`;
    await owner
      .post('/api/v1/users')
      .send({
        name: `Imp ${label}`,
        email,
        password: 'Password123!',
        roleId: roles.find((r) => r.name === role)!.id,
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
  const counts = async () => ({
    items: await prisma.menuItem.count({ where: { branchId: BRANCH } }),
    cats: await prisma.menuCategory.count({ where: { branchId: BRANCH } }),
    ings: await prisma.ingredient.count({ where: { branchId: BRANCH } }),
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
    manager = await mkUser('manager', 'RESTAURANT_MANAGER');
    cashier = await mkUser('cashier', 'CASHIER');
    const oe = `imp-other-${tag}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ownerName: 'Other',
        email: oe,
        password: 'Password123!',
        restaurantName: `Other ${tag}`,
        branchName: 'Main',
      })
      .expect(201);
    other = request.agent(app.getHttpServer());
    await other
      .post('/api/v1/auth/login')
      .send({ email: oe, password: 'Password123!' })
      .expect(201);
  });

  afterAll(async () => {
    const ids = (
      await prisma.ingredient.findMany({
        where: { branchId: BRANCH, name: { startsWith: `T${tag}` } },
        select: { id: true },
      })
    ).map((i) => i.id);
    await prisma.stockMovement.deleteMany({
      where: { ingredientId: { in: ids } },
    });
    await prisma.ingredient.deleteMany({ where: { id: { in: ids } } });
    await prisma.menuItem.deleteMany({
      where: { branchId: BRANCH, name: { startsWith: `T${tag}` } },
    });
    await prisma.menuCategory.deleteMany({
      where: { branchId: BRANCH, name: { startsWith: `T${tag}` } },
    });
    await prisma.kitchenStation.deleteMany({
      where: { branchId: BRANCH, name: { startsWith: `T${tag}` } },
    });
    await app.close();
  });

  describe('templates', () => {
    it('downloads blank and example files that Excel opens as UTF-8', async () => {
      const ex = await manager.get(`${I}/templates/menu?example=1`).expect(200);
      expect(ex.headers['content-type']).toMatch(/text\/csv/);
      expect(ex.headers['content-disposition']).toMatch(
        /menu-items-example\.csv/,
      );
      expect(ex.text.charCodeAt(0)).toBe(0xfeff);
      expect(ex.text).toContain('Paneer Tikka');
      const blank = await manager.get(`${I}/templates/ingredients`).expect(200);
      expect(blank.headers['content-disposition']).toMatch(
        /ingredients-template\.csv/,
      );
      expect(blank.text.split(/\r?\n/).filter(Boolean)).toHaveLength(1);
    });

    it('is closed to people who cannot manage that data', async () => {
      await cashier.get(`${I}/templates/menu`).expect(403);
      await cashier.get(`${I}/templates/ingredients`).expect(403);
      await request(app.getHttpServer()).get(`${I}/templates/menu`).expect(401);
      await manager.get(`${I}/templates/nonsense`).expect(400);
    });

    it('the shipped example file imports cleanly through the real endpoint', async () => {
      const ex = (await manager.get(`${I}/templates/menu?example=1`)).text;
      const r = await send(manager, 'menu', 'preview', ex).expect(201);
      expect(r.body.summary.errors).toBe(0);
      expect(r.body.summary.total).toBe(7);
      const ing = (await manager.get(`${I}/templates/ingredients?example=1`))
        .text;
      const r2 = await send(manager, 'ingredients', 'preview', ing).expect(201);
      expect(r2.body.summary.errors).toBe(0);
    });
  });

  describe('menu items', () => {
    const cat = `T${tag} Starters`;
    const file = () =>
      menuCsv([
        `T${tag} Paneer Tikka,${cat},280,160,5,TS-${tag}-1,"Char-grilled, with chutney",T${tag} Tandoor,yes,MEDIUM,dairy;nuts,,,yes`,
        `T${tag} Chicken 65,${cat},320,,5,TS-${tag}-2,,T${tag} Tandoor,no,HOT,,,,yes`,
        `T${tag} Masala Chai,T${tag} Drinks,40,,5,TS-${tag}-3,,,yes,NONE,dairy,06:00,22:00,yes`,
      ]);

    it('a preview shows what would happen and saves nothing', async () => {
      const before = await counts();
      const r = await send(manager, 'menu', 'preview', file()).expect(201);
      expect(r.body.applied).toBe(false);
      expect(r.body.summary).toMatchObject({
        total: 3,
        create: 3,
        update: 0,
        errors: 0,
      });
      expect(r.body.newCategories.sort()).toEqual(
        [cat, `T${tag} Drinks`].sort(),
      );
      expect(r.body.newStations).toEqual([`T${tag} Tandoor`]);
      expect(await counts()).toEqual(before);
    });

    it('commit creates the items, categories and stations with the right values', async () => {
      const r = await send(manager, 'menu', 'commit', file()).expect(201);
      expect(r.body.applied).toBe(true);
      expect(r.body.summary.create).toBe(3);
      const tikka = await prisma.menuItem.findFirstOrThrow({
        where: { branchId: BRANCH, sku: `TS-${tag}-1` },
        include: { category: true, station: true },
      });
      expect(tikka.category.name).toBe(cat);
      expect(tikka.station?.name).toBe(`T${tag} Tandoor`);
      expect(Number(tikka.price)).toBe(280);
      expect(Number(tikka.halfPrice)).toBe(160);
      expect(Number(tikka.taxRatePercent)).toBe(5);
      expect(tikka.description).toBe('Char-grilled, with chutney');
      expect(tikka.allergens).toEqual(['dairy', 'nuts']);
      expect(tikka.spiceLevel).toBe('MEDIUM');
      expect(tikka.isVeg).toBe(true);
      const chicken = await prisma.menuItem.findFirstOrThrow({
        where: { branchId: BRANCH, sku: `TS-${tag}-2` },
      });
      expect(chicken.isVeg).toBe(false);
      const chai = await prisma.menuItem.findFirstOrThrow({
        where: { branchId: BRANCH, sku: `TS-${tag}-3` },
      });
      expect([chai.availableFrom, chai.availableTo]).toEqual([
        '06:00',
        '22:00',
      ]);
      // They are visible to the POS through the normal API.
      const list = (await owner.get(`/api/v1/menu/items?${q}`).expect(200))
        .body as { name: string }[];
      expect(list.some((i) => i.name === `T${tag} Paneer Tikka`)).toBe(true);
    });

    it('importing the same file again changes nothing and creates no duplicates', async () => {
      const before = await counts();
      const r = await send(manager, 'menu', 'commit', file()).expect(201);
      expect(r.body.summary).toMatchObject({
        create: 0,
        update: 0,
        unchanged: 3,
        errors: 0,
      });
      expect(await counts()).toEqual(before);
    });

    it('an edit updates only what changed, and blank cells never wipe existing data', async () => {
      const edited = menuCsv([
        `T${tag} Paneer Tikka,${cat},300,,5,TS-${tag}-1,,,,,,,,`,
      ]);
      const pre = await send(manager, 'menu', 'preview', edited).expect(201);
      expect(pre.body.rows[0]).toMatchObject({
        action: 'update',
        changes: ['price'],
      });
      await send(manager, 'menu', 'commit', edited).expect(201);
      const t = await prisma.menuItem.findFirstOrThrow({
        where: { branchId: BRANCH, sku: `TS-${tag}-1` },
      });
      expect(Number(t.price)).toBe(300);
      expect(Number(t.halfPrice)).toBe(160); // blank half_price left alone
      expect(t.description).toBe('Char-grilled, with chutney'); // blank description left alone
      expect(t.allergens).toEqual(['dairy', 'nuts']);
    });

    it('can leave existing items alone when asked', async () => {
      const edited = menuCsv([
        `T${tag} Paneer Tikka,${cat},999,,,TS-${tag}-1,,,,,,,,`,
      ]);
      const r = await send(
        manager,
        'menu',
        'commit',
        edited,
        '&updateExisting=false',
      ).expect(201);
      expect(r.body.summary.skipped).toBe(1);
      const t = await prisma.menuItem.findFirstOrThrow({
        where: { branchId: BRANCH, sku: `TS-${tag}-1` },
      });
      expect(Number(t.price)).toBe(300);
    });

    it('matches by name when a row has no SKU, ignoring case, and can add the SKU later', async () => {
      await prisma.menuItem.create({
        data: {
          branchId: BRANCH,
          categoryId: (
            await prisma.menuCategory.findFirstOrThrow({
              where: { branchId: BRANCH, name: cat },
            })
          ).id,
          name: `T${tag} Old Dish`,
          price: 10,
        },
      });
      const before = await counts();
      const r = await send(
        manager,
        'menu',
        'commit',
        menuCsv([
          `t${tag} old dish,${cat.toLowerCase()},55,,,TS-${tag}-9,,,,,,,,`,
        ]),
      ).expect(201);
      expect(r.body.summary).toMatchObject({ create: 0, update: 1 });
      expect(await counts()).toEqual(before); // same item, not a copy
      const d = await prisma.menuItem.findFirstOrThrow({
        where: { branchId: BRANCH, name: `T${tag} Old Dish` }, // capitalisation kept
      });
      expect([Number(d.price), d.sku]).toEqual([55, `TS-${tag}-9`]);
    });

    it('is all-or-nothing by default when some rows are bad, with line numbers', async () => {
      const bad = menuCsv([
        `T${tag} Good One,${cat},10,,,,,,,,,,,`,
        `T${tag} Bad Price,${cat},abc,,,,,,,,,,,`,
        `,${cat},10,,,,,,,,,,,`,
      ]);
      const before = await counts();
      const pre = await send(manager, 'menu', 'preview', bad).expect(201);
      expect(pre.body.errors.map((e: { line: number }) => e.line)).toEqual([
        3, 4,
      ]);
      expect(pre.body.errors[0].messages[0]).toMatch(/not a number/);
      const res = await send(manager, 'menu', 'commit', bad);
      expect(res.status).toBe(422);
      expect(res.body.errors).toHaveLength(2);
      expect(await counts()).toEqual(before);
    });

    it('can import just the valid rows when the user chooses to', async () => {
      const bad = menuCsv([
        `T${tag} Good Two,${cat},10,,,,,,,,,,,`,
        `T${tag} Bad Two,${cat},-5,,,,,,,,,,,`,
      ]);
      const r = await send(
        manager,
        'menu',
        'commit',
        bad,
        '&skipInvalid=true',
      ).expect(201);
      expect(r.body.summary).toMatchObject({ create: 1, errors: 1 });
      expect(
        await prisma.menuItem.count({
          where: { branchId: BRANCH, name: `T${tag} Good Two` },
        }),
      ).toBe(1);
      expect(
        await prisma.menuItem.count({
          where: { branchId: BRANCH, name: `T${tag} Bad Two` },
        }),
      ).toBe(0);
    });

    it('catches an unquoted comma instead of shifting columns', async () => {
      const r = await send(
        manager,
        'menu',
        'preview',
        menuCsv([`T${tag} Dal, Tadka,${cat},10,,,,,,,,,,,`]),
      ).expect(201);
      expect(r.body.errors[0].messages.join(' ')).toMatch(
        /wrapped in "quotes"/,
      );
      // Nothing is imported from a row whose columns have shifted.
      expect(r.body.summary.create).toBe(0);
    });

    it('reads Excel semicolon files and Windows-1252 text', async () => {
      const semi =
        `name;category;price\n` +
        `T${tag} Semi;${cat};12,5\n`.replace('12,5', '12.5');
      const a = await send(manager, 'menu', 'preview', semi).expect(201);
      expect(a.body.delimiter).toBe(';');
      expect(a.body.summary.create).toBe(1);
      const cp = Buffer.concat([
        Buffer.from(`name,category,price\nT${tag} Caf`),
        Buffer.from([0xe9]),
        Buffer.from(`,${cat},20\n`),
      ]);
      const b = await send(manager, 'menu', 'preview', cp).expect(201);
      expect(b.body.fileNote).toMatch(/Windows-1252/);
      expect(b.body.rows[0].name).toBe(`T${tag} Café`);
    });

    it('rejects unusable files with a clear message', async () => {
      const missing = await send(
        manager,
        'menu',
        'preview',
        'name,price\nTea,10\n',
      );
      expect(missing.status).toBe(400);
      expect(missing.body.message).toMatch(/Missing required column: category/);
      expect((await send(manager, 'menu', 'preview', '')).status).toBe(400);
      expect(
        (await send(manager, 'menu', 'preview', 'a,b\n"open,1')).body.message,
      ).toMatch(/never closed/);
      expect(
        (await send(manager, 'menu', 'preview', 'x', '', 'notes.pdf')).status,
      ).toBe(400);
      const big = Buffer.alloc(2 * 1024 * 1024 + 10, 'a');
      expect((await send(manager, 'menu', 'preview', big)).status).toBe(413);
      await manager.post(`${I}/menu/preview?${q}`).expect(400); // no file at all
    });

    it('needs menu.manage and a branch you may use', async () => {
      await send(cashier, 'menu', 'preview', file()).expect(403);
      await send(cashier, 'menu', 'commit', file()).expect(403);
      await request(app.getHttpServer())
        .post(`${I}/menu/commit?${q}`)
        .attach('file', Buffer.from(file()), 'a.csv')
        .expect(401);
      // Another restaurant cannot write into this branch.
      const before = await counts();
      await send(other, 'menu', 'commit', file()).expect(403);
      expect(await counts()).toEqual(before);
    });

    it('records an audit entry with counts but not the file contents', async () => {
      const a = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'import.menu' },
        orderBy: { createdAt: 'desc' },
      });
      const meta = a.metadata as any;
      expect(meta.file).toBe('import.csv');
      expect(typeof meta.create).toBe('number');
      expect(JSON.stringify(meta)).not.toContain('Paneer');
    });
  });

  describe('ingredients', () => {
    const name = (n: string) => `T${tag} ${n}`;
    const file = () =>
      ingCsv([
        `${name('Rice')},kg,ING-${tag}-1,25,95,60,yes`,
        `${name('Oil')},ltr,,15,140,40,yes`,
        `${name('Tea')},g,,1000,0.45,5000,yes`,
      ]);

    it('creates ingredients with opening stock recorded in the stock ledger', async () => {
      const pre = await send(manager, 'ingredients', 'preview', file()).expect(
        201,
      );
      expect(pre.body.summary).toMatchObject({ create: 3, errors: 0 });
      expect(
        await prisma.ingredient.count({
          where: { branchId: BRANCH, name: { startsWith: `T${tag}` } },
        }),
      ).toBe(0);
      await send(manager, 'ingredients', 'commit', file()).expect(201);
      const rice = await prisma.ingredient.findFirstOrThrow({
        where: { branchId: BRANCH, name: name('Rice') },
      });
      expect([
        rice.unit,
        Number(rice.currentStock),
        Number(rice.costPerUnit),
        Number(rice.reorderLevel),
      ]).toEqual(['KG', 60, 95, 25]);
      const tea = await prisma.ingredient.findFirstOrThrow({
        where: { branchId: BRANCH, name: name('Tea') },
      });
      expect([tea.unit, Number(tea.costPerUnit)]).toEqual(['G', 0.45]);
      const moves = await prisma.stockMovement.findMany({
        where: { ingredientId: rice.id },
      });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({
        type: 'ADJUSTMENT',
        note: 'Opening stock (CSV import)',
      });
      expect(Number(moves[0].quantity)).toBe(60);
      // The ledger and the cached stock agree.
      const sum = moves.reduce((s, m) => s + Number(m.quantity), 0);
      expect(sum).toBe(Number(rice.currentStock));
    });

    it('re-importing never doubles the stock', async () => {
      const r = await send(manager, 'ingredients', 'commit', file()).expect(
        201,
      );
      expect(r.body.summary).toMatchObject({
        create: 0,
        update: 0,
        unchanged: 3,
      });
      expect(r.body.warnings.length).toBeGreaterThan(0); // "already has stock history"
      const rice = await prisma.ingredient.findFirstOrThrow({
        where: { branchId: BRANCH, name: name('Rice') },
      });
      expect(Number(rice.currentStock)).toBe(60);
      expect(
        await prisma.stockMovement.count({ where: { ingredientId: rice.id } }),
      ).toBe(1);
    });

    it('updates reorder level and cost without touching stock; matches names ignoring case', async () => {
      const r = await send(
        manager,
        'ingredients',
        'commit',
        ingCsv([`${name('rice').toLowerCase()},KG,,30,100,9999,`]),
      ).expect(201);
      expect(r.body.summary.update).toBe(1);
      expect(r.body.rows[0].changes).toEqual(['reorder level', 'cost']);
      const rice = await prisma.ingredient.findFirstOrThrow({
        where: { branchId: BRANCH, name: name('Rice') },
      });
      expect([
        Number(rice.reorderLevel),
        Number(rice.costPerUnit),
        Number(rice.currentStock),
      ]).toEqual([30, 100, 60]);
    });

    it("refuses to change an existing ingredient's unit", async () => {
      const r = await send(
        manager,
        'ingredients',
        'preview',
        ingCsv([`${name('Rice')},G,,,,,`]),
      ).expect(201);
      expect(r.body.errors[0].messages[0]).toMatch(/unit cannot be changed/);
    });

    it('gives opening stock to an existing ingredient only if it has no history', async () => {
      await prisma.ingredient.create({
        data: { branchId: BRANCH, name: name('Salt'), unit: 'KG' },
      });
      await send(
        manager,
        'ingredients',
        'commit',
        ingCsv([`${name('Salt')},KG,,,,12,`]),
      ).expect(201);
      const salt = await prisma.ingredient.findFirstOrThrow({
        where: { branchId: BRANCH, name: name('Salt') },
      });
      expect(Number(salt.currentStock)).toBe(12);
      expect(
        await prisma.stockMovement.count({ where: { ingredientId: salt.id } }),
      ).toBe(1);
    });

    it('validates units and numbers per row and is permission-checked', async () => {
      const r = await send(
        manager,
        'ingredients',
        'preview',
        ingCsv([`${name('X')},bucket,,,,,`, `${name('Y')},KG,,-1,,,`]),
      ).expect(201);
      expect(r.body.errors.map((e: { line: number }) => e.line)).toEqual([
        2, 3,
      ]);
      await send(cashier, 'ingredients', 'preview', file()).expect(403);
      await send(other, 'ingredients', 'commit', file()).expect(403);
    });

    it('imported ingredients appear in the Inventory list', async () => {
      const list = (
        await owner.get(`/api/v1/inventory/ingredients?${q}`).expect(200)
      ).body as { name: string }[];
      expect(list.some((i) => i.name === name('Rice'))).toBe(true);
    });
  });
});
