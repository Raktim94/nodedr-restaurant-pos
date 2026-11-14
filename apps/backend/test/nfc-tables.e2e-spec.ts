/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped by design */
// Secure NFC table tags (NTAG 424 DNA SUN) and automatic table sessions, end to end:
// provisioning, verified taps, replay and forgery, concurrent first orders, session lifecycle, rotation, replacement.
//   NFC_E2E=1 DATABASE_URL=... JWT_SECRET=x npx jest --config ./test/jest-e2e.json --runInBand nfc-tables
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { simulateTap } from './../src/modules/nfc/nfc-sdm';
import { PrismaService } from './../src/prisma/prisma.service';

const run = process.env.NFC_E2E ? describe : describe.skip;
const tag = randomUUID().slice(0, 6);
const BRANCH = 'demo-branch';
const q = `?branchId=${BRANCH}`;
const UID = '04A1B2C3D4E5F6';

run('Secure NFC table tags and automatic sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let owner: ReturnType<typeof request.agent>;
  let cashier: ReturnType<typeof request.agent>;
  let guest: ReturnType<typeof request.agent>;
  let floorId: string;
  let itemId: string;
  const T: Record<string, { id: string; qr: string }> = {};
  let nextCounter = 10;
  const ctr = () => nextCounter++;

  type Keys = { metaKeyHex: string; fileKeyHex: string };
  const keysOf = (provisioning: {
    keys: { sdmMetaReadKey: string; sdmFileReadKey: string };
  }): Keys => ({
    metaKeyHex: provisioning.keys.sdmMetaReadKey,
    fileKeyHex: provisioning.keys.sdmFileReadKey,
  });
  const tapUrl = (ref: string, t: { e: string; c: string }) =>
    `/api/v1/public/nfc/tap/${ref}?e=${t.e}&c=${t.c}`;
  const mkTable = async (n: string) => {
    const t = (
      await owner
        .post(`/api/v1/tables${q}`)
        .send({ floorId, number: `${n}-${tag}`, capacity: 4 })
        .expect(201)
    ).body;
    T[n] = {
      id: t.id,
      qr: (await owner.post(`/api/v1/tables/${t.id}/qr-token${q}`).expect(201))
        .body.qrToken,
    };
  };
  // A tag created, written (simulated) and proven by a staff test tap: ready for guests.
  const activeTag = async (table: string, uid = UID) => {
    const made = (
      await owner
        .post(`/api/v1/nfc/tags${q}`)
        .send({ tableId: T[table].id, label: `Tag ${table}` })
        .expect(201)
    ).body;
    const keys = keysOf(made.provisioning);
    await owner
      .post(`/api/v1/nfc/tags/${made.tag.id}/test${q}`)
      .send(simulateTap(keys, uid, ctr()))
      .expect(201);
    return {
      id: made.tag.id as string,
      ref: made.tag.publicRef as string,
      keys,
      uid,
    };
  };
  const order = (
    table: string,
    headers: Record<string, string>,
    name = 'Asha',
  ) => {
    const r = guest.post(`/api/v1/public/menu/${T[table].qr}/order`);
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r.send({
      guestName: name,
      items: [{ menuItemId: itemId, quantity: 1, modifierIds: [] }],
    });
  };
  const sessionsOf = (table: string) =>
    prisma.tableSession.findMany({
      where: { tableId: T[table].id },
      orderBy: { openedAt: 'asc' },
    });
  const stateOf = async (table: string) =>
    (
      await owner.get(`/api/v1/tables/overview${q}`).expect(200)
    ).body.tables.find((t: { id: string }) => t.id === T[table].id);
  const flags = (nfcTablesEnabled: boolean, autoTableSessions: boolean) =>
    owner
      .patch('/api/v1/nfc/settings')
      .send({ nfcTablesEnabled, autoTableSessions });

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
        name: 'c',
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
    guest = request.agent(app.getHttpServer());
    floorId = (
      await owner
        .post(`/api/v1/tables/floors${q}`)
        .send({ name: `Nfc ${tag}` })
        .expect(201)
    ).body.id;
    for (const n of ['A', 'B', 'C']) await mkTable(n);
    const dishes = (await owner.get(`/api/v1/menu/items${q}`).expect(200))
      .body as { id: string; name: string }[];
    itemId = (
      dishes.find((d) => d.name === 'Coca-Cola') ??
      dishes.find((d) => d.name.startsWith('PlainItem')) ??
      dishes[0]
    ).id;
    await owner
      .patch(`/api/v1/inventory/manufacturing/settings${q}`)
      .send({ requireTableSession: true })
      .expect(200);
  });
  afterAll(async () => {
    await flags(false, false);
    await prisma.floor.deleteMany({ where: { id: floorId } });
    await app.close();
  });

  it('the two switches: only staff with nfc.manage may change them, and automatic sessions need tags first', async () => {
    expect((await cashier.get('/api/v1/nfc/settings')).status).toBe(403);
    expect(
      (
        await cashier
          .patch('/api/v1/nfc/settings')
          .send({ nfcTablesEnabled: true })
      ).status,
    ).toBe(403);
    await flags(false, false).expect(200);
    const s0 = (await owner.get('/api/v1/nfc/settings').expect(200)).body;
    expect(s0.mode).toBe('BASIC');
    const bad = await owner
      .patch('/api/v1/nfc/settings')
      .send({ autoTableSessions: true });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/NFC table tags switched on first/);
    await prisma.restaurant.updateMany({
      data: { requireTableSession: false },
    });
    const on = (await flags(true, true).expect(200)).body;
    expect(on.requireTableSession).toBe(true); // switching tags on keeps table proof required
    expect(on).toEqual(
      expect.objectContaining({
        nfcTablesEnabled: true,
        autoTableSessions: true,
        mode: 'ADVANCED',
      }),
    );
    expect((await flags(false, true)).status).toBe(400); // cannot switch tags off under automatic sessions
  });

  it('provisioning returns the keys once, stores only sealed copies, and a tag is unusable until a staff test tap proves it', async () => {
    const res = (
      await owner
        .post(`/api/v1/nfc/tags${q}`)
        .send({ tableId: T.A.id, label: 'Door' })
        .expect(201)
    ).body;
    const { tag: created, provisioning } = res;
    expect(created.status).toBe('PROVISIONING');
    expect(provisioning.urlTemplate).toContain(`/t/${created.publicRef}?e=`);
    const keys = keysOf(provisioning);
    expect(keys.metaKeyHex).toMatch(/^[0-9a-f]{32}$/);
    const row = await prisma.nfcTag.findUniqueOrThrow({
      where: { id: created.id },
    });
    for (const hex of [
      keys.metaKeyHex,
      keys.fileKeyHex,
      provisioning.keys.appMasterKey,
    ]) {
      expect(JSON.stringify(row)).not.toContain(hex);
      expect(
        JSON.stringify(
          (await owner.get(`/api/v1/nfc/tags${q}`).expect(200)).body,
        ),
      ).not.toContain(hex);
    }
    // Before activation a tap is refused, even a perfectly genuine one.
    const early = await guest.get(
      tapUrl(created.publicRef, simulateTap(keys, UID, ctr())),
    );
    expect(early.status).toBe(403);
    // Wrong keys: the staff test refuses and nothing is bound.
    const wrong = simulateTap(
      { metaKeyHex: '11'.repeat(16), fileKeyHex: '22'.repeat(16) },
      UID,
      ctr(),
    );
    expect(
      (await owner.post(`/api/v1/nfc/tags/${created.id}/test${q}`).send(wrong))
        .status,
    ).toBe(400);
    expect(
      (await prisma.nfcTag.findUniqueOrThrow({ where: { id: created.id } }))
        .uid,
    ).toBeNull();
    // Genuine test tap: the chip's UID is bound and the tag becomes ACTIVE.
    const ok = (
      await owner
        .post(`/api/v1/nfc/tags/${created.id}/test${q}`)
        .send(simulateTap(keys, UID, ctr()))
        .expect(201)
    ).body;
    expect(ok.status).toBe('ACTIVE');
    expect(ok.uid).toBe(UID);
    // A different chip holding the same keys is refused: the UID is bound.
    expect(
      (
        await owner
          .post(`/api/v1/nfc/tags/${created.id}/test${q}`)
          .send(simulateTap(keys, '04FFFFFFFFFFFF', ctr()))
      ).status,
    ).toBe(400);
    (T.A as { tag?: unknown }).tag = {
      id: created.id,
      ref: created.publicRef,
      keys,
    };
  });

  let a: { id: string; ref: string; keys: Keys };
  let grantA1: string;

  it('a verified tap proves the guest is at THIS table and opens nothing: the first order does', async () => {
    a = (T.A as { tag?: typeof a }).tag!;
    const t = (
      await guest
        .get(tapUrl(a.ref, simulateTap(a.keys, UID, ctr())))
        .expect(200)
    ).body;
    expect(t.qrToken).toBe(T.A.qr);
    expect(t.accessToken.length).toBeGreaterThan(30);
    expect(await sessionsOf('A')).toHaveLength(0);
    expect((await stateOf('A')).state).toBe('ACCESS_VERIFIED');
    // The token is stored only as a hash.
    expect(
      JSON.stringify(
        await prisma.tableAccess.findMany({ where: { tableId: T.A.id } }),
      ),
    ).not.toContain(t.accessToken);

    const placed = await order('A', { 'x-table-access': t.accessToken }).expect(
      201,
    );
    expect(placed.body.sessionGrant.length).toBeGreaterThan(30);
    grantA1 = placed.body.sessionGrant;
    const sessions = await sessionsOf('A');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].openedVia).toBe('NFC');
    expect(sessions[0].openedById).toBeNull();
    expect(sessions[0].status).toBe('ACTIVE');
    expect((await stateOf('A')).state).toBe('ORDER_PROCESSING');
  });

  it('a second guest taps and joins the same session with their own grant', async () => {
    const t = (
      await guest
        .get(tapUrl(a.ref, simulateTap(a.keys, UID, ctr())))
        .expect(200)
    ).body;
    const second = await order(
      'A',
      { 'x-table-access': t.accessToken },
      'Ravi',
    ).expect(201);
    expect(second.body.sessionGrant).not.toBe(grantA1);
    expect(await sessionsOf('A')).toHaveLength(1);
    // Each phone can now order, ask for the waiter and pay with its session grant, with no further tap.
    await order('A', { 'x-table-session': grantA1 }).expect(201);
    expect(
      (
        await guest
          .post(`/api/v1/public/menu/${T.A.qr}/request`)
          .set('x-table-session', second.body.sessionGrant)
          .send({ type: 'WAITER' })
      ).status,
    ).toBeLessThan(300);
    expect((await stateOf('A')).state).toBe('ATTENTION_REQUIRED'); // a guest call needs a person
    await prisma.tableRequest.updateMany({
      where: { tableId: T.A.id },
      data: { resolvedAt: new Date() },
    });
  });

  it('replays, old counters, forged MACs and cloned chips are all refused, and a forgery cannot burn the real counter', async () => {
    const before = await prisma.nfcTag.findUniqueOrThrow({
      where: { id: a.id },
    });
    const good = simulateTap(a.keys, UID, ctr());
    await guest.get(tapUrl(a.ref, good)).expect(200);
    const replay = await guest.get(tapUrl(a.ref, good));
    expect(replay.status).toBe(403);
    expect(replay.body.code).toBe('NFC_REPLAY');
    const old = await guest.get(
      tapUrl(a.ref, simulateTap(a.keys, UID, before.lastCounter - 1)),
    );
    expect(old.status).toBe(403);
    const after = await prisma.nfcTag.findUniqueOrThrow({
      where: { id: a.id },
    });

    // Forged: a valid-looking e with a counter far ahead and a wrong MAC.
    const far = simulateTap(a.keys, UID, 999_000);
    const forged = await guest.get(
      tapUrl(a.ref, { e: far.e, c: '0000000000000000' }),
    );
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe('NFC_VERIFY_FAILED');
    // Cloned/other chip with the right keys: refused, counter untouched.
    const clone = await guest.get(
      tapUrl(a.ref, simulateTap(a.keys, '04FFFFFFFFFFFF', 999_001)),
    );
    expect(clone.status).toBe(403);
    // Wrong keys, garbage and an unknown tag all give the same generic answer.
    for (const url of [
      tapUrl(
        a.ref,
        simulateTap(
          { metaKeyHex: '33'.repeat(16), fileKeyHex: '44'.repeat(16) },
          UID,
          999_002,
        ),
      ),
      tapUrl(a.ref, { e: 'zz', c: 'zz' }),
      tapUrl('nosuchtag', good),
      `/api/v1/public/nfc/tap/${a.ref}`,
    ]) {
      const r = await guest.get(url);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('NFC_VERIFY_FAILED');
    }
    expect(
      (await prisma.nfcTag.findUniqueOrThrow({ where: { id: a.id } }))
        .lastCounter,
    ).toBe(after.lastCounter);
    const results = (
      await owner.get(`/api/v1/nfc/tags/${a.id}/taps${q}`).expect(200)
    ).body.map((t: { result: string }) => t.result);
    expect(results).toEqual(
      expect.arrayContaining([
        'OK',
        'REPLAY',
        'BAD_MAC',
        'UID_MISMATCH',
        'TEST_OK',
      ]),
    );
  });

  it('two requests carrying the same tap: exactly one wins', async () => {
    const same = simulateTap(a.keys, UID, ctr());
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => guest.get(tapUrl(a.ref, same))),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 403)).toHaveLength(5);
  });

  it('guests ordering at the same moment at a closed table open exactly one session', async () => {
    const b = await activeTag('B', '04B0B0B0B0B0B0');
    const taps = await Promise.all(
      Array.from({ length: 6 }, () =>
        guest.get(tapUrl(b.ref, simulateTap(b.keys, b.uid, ctr()))),
      ),
    );
    const tokens = taps
      .filter((r) => r.status === 200)
      .map((r) => r.body.accessToken as string);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    const placed = await Promise.all(
      tokens.map((tk, i) => order('B', { 'x-table-access': tk }, `G${i}`)),
    );
    expect(placed.every((r) => r.status === 201)).toBe(true);
    const sessions = await sessionsOf('B');
    expect(sessions.filter((s) => s.status === 'ACTIVE')).toHaveLength(1);
  });

  it('a table that never had an ordering link gets one when its first tag is created, so a tap can lead somewhere', async () => {
    const bare = (
      await owner
        .post(`/api/v1/tables${q}`)
        .send({ floorId, number: `N-${tag}`, capacity: 2 })
        .expect(201)
    ).body;
    expect(
      (await prisma.table.findUniqueOrThrow({ where: { id: bare.id } }))
        .qrToken,
    ).toBeNull();
    const made = (
      await owner
        .post(`/api/v1/nfc/tags${q}`)
        .send({ tableId: bare.id })
        .expect(201)
    ).body;
    const keys = keysOf(made.provisioning);
    await owner
      .post(`/api/v1/nfc/tags/${made.tag.id}/test${q}`)
      .send(simulateTap(keys, '04ABABABABABAB', ctr()))
      .expect(201);
    const t = (
      await guest
        .get(
          tapUrl(
            made.tag.publicRef,
            simulateTap(keys, '04ABABABABABAB', ctr()),
          ),
        )
        .expect(200)
    ).body;
    expect(t.qrToken).toMatch(/^[0-9a-f]{32}$/);
    expect(
      (await prisma.table.findUniqueOrThrow({ where: { id: bare.id } }))
        .qrToken,
    ).toBe(t.qrToken);
  });

  it('a burst of simultaneous orders gets distinct numbers and none are refused (a number race used to reject most of them)', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        owner.post(`/api/v1/orders${q}`).send({
          type: 'TAKEAWAY',
          items: [{ menuItemId: itemId, quantity: 1, modifierIds: [] }],
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    expect(new Set(results.map((r) => r.body.orderNumber as string)).size).toBe(
      12,
    );
  });

  it('a tap never works for a table it does not belong to, and ordering without proof is refused', async () => {
    const t = (
      await guest
        .get(tapUrl(a.ref, simulateTap(a.keys, UID, ctr())))
        .expect(200)
    ).body;
    const wrongTable = await order('B', { 'x-table-access': t.accessToken });
    expect(wrongTable.status).toBe(403);
    expect(wrongTable.body.code).toBe('TABLE_SESSION_REQUIRED');
    const none = await order('A', {});
    expect(none.status).toBe(403);
    expect(
      (await order('A', { 'x-table-access': 'not-a-real-access-token' }))
        .status,
    ).toBe(403);
    // Expired proof.
    await prisma.tableAccess.updateMany({
      where: { tableId: T.A.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await order('A', { 'x-table-access': t.accessToken });
    expect(expired.status).toBe(403);
    expect(expired.body.code).toBe('TABLE_SESSION_EXPIRED');
  });

  it('settling the last order closes the session and clears the table; the next guests open a new one', async () => {
    const open = await prisma.order.findMany({
      where: { tableId: T.A.id, status: 'OPEN' },
    });
    expect(open.length).toBeGreaterThan(0);
    for (const o of open) {
      const full = (await owner.get(`/api/v1/orders/${o.id}${q}`).expect(200))
        .body;
      await owner
        .post(`/api/v1/orders/${o.id}/checkout${q}`)
        .send({
          payments: [{ method: 'CASH', amount: Number(full.totalAmount) }],
          requestId: randomUUID(),
        })
        .expect(201);
    }
    expect((await sessionsOf('A')).every((s) => s.status === 'CLOSED')).toBe(
      true,
    );
    expect((await stateOf('A')).state).toBe('SETTLED');
    // The old grants no longer work; a fresh tap and order open a second session.
    expect((await order('A', { 'x-table-session': grantA1 })).status).toBe(403);
    const t = (
      await guest
        .get(tapUrl(a.ref, simulateTap(a.keys, UID, ctr())))
        .expect(200)
    ).body;
    await order('A', { 'x-table-access': t.accessToken }).expect(201);
    expect(await sessionsOf('A')).toHaveLength(2);
  });

  it('an unpaid table is never closed by the clock: the session stays usable past its expiry while an order is open', async () => {
    const s = (await sessionsOf('A')).find((x) => x.status === 'ACTIVE')!;
    await prisma.tableSession.update({
      where: { id: s.id },
      data: { expiresAt: new Date(Date.now() - 3_600_000) },
    });
    const t = (
      await guest
        .get(tapUrl(a.ref, simulateTap(a.keys, UID, ctr())))
        .expect(200)
    ).body;
    const again = await order('A', { 'x-table-access': t.accessToken }).expect(
      201,
    );
    expect(
      (await sessionsOf('A')).filter((x) => x.status === 'ACTIVE'),
    ).toHaveLength(1);
    expect(
      (await order('A', { 'x-table-session': again.body.sessionGrant })).status,
    ).toBe(201);
  });

  it('switching tags off stops taps and tag-based orders at once, with a clear message; QR and staff code still work', async () => {
    await flags(false, false).expect(200);
    const tap = await guest.get(tapUrl(a.ref, simulateTap(a.keys, UID, ctr())));
    expect(tap.status).toBe(403);
    expect(tap.body.code).toBe('NFC_OFF');
    const staffSession = (
      await cashier
        .post(`/api/v1/tables/${T.C.id}/session${q}`)
        .send({})
        .expect(201)
    ).body;
    const grant = (
      await guest
        .post(`/api/v1/public/menu/${T.C.qr}/session`)
        .send({ code: staffSession.code })
        .expect(201)
    ).body.token;
    await order('C', { 'x-table-session': grant }).expect(201); // the basic flow is untouched
    await flags(true, true).expect(200);
  });

  it('rotating keys kills the old ones at once and the tag must be proven again', async () => {
    const old = a.keys;
    const rot = (
      await owner.post(`/api/v1/nfc/tags/${a.id}/rotate${q}`).expect(201)
    ).body;
    expect(rot.tag.status).toBe('PROVISIONING');
    expect(rot.tag.keyVersion).toBe(2);
    expect(
      (await guest.get(tapUrl(a.ref, simulateTap(old, UID, ctr())))).status,
    ).toBe(403);
    const fresh = keysOf(rot.provisioning);
    expect(fresh.metaKeyHex).not.toBe(old.metaKeyHex);
    expect(
      (await guest.get(tapUrl(a.ref, simulateTap(fresh, UID, ctr())))).status,
    ).toBe(403); // not proven yet
    await owner
      .post(`/api/v1/nfc/tags/${a.id}/test${q}`)
      .send(simulateTap(fresh, UID, ctr()))
      .expect(201);
    await guest.get(tapUrl(a.ref, simulateTap(fresh, UID, ctr()))).expect(200);
    expect(
      (await guest.get(tapUrl(a.ref, simulateTap(old, UID, ctr())))).status,
    ).toBe(403);
    a = { ...a, keys: fresh };
  });

  it('a compromised tag is disabled, and a damaged one replaced: the old record can never answer again', async () => {
    const fresh = await activeTag('C', '04C0C0C0C0C0C0');
    await guest
      .get(tapUrl(fresh.ref, simulateTap(fresh.keys, fresh.uid, ctr())))
      .expect(200);
    const dis = (
      await owner
        .post(`/api/v1/nfc/tags/${fresh.id}/disable${q}`)
        .send({ reason: 'Photographed and shared' })
        .expect(201)
    ).body;
    expect(dis.status).toBe('DISABLED');
    expect(
      (
        await guest.get(
          tapUrl(fresh.ref, simulateTap(fresh.keys, fresh.uid, ctr())),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .post(`/api/v1/nfc/tags/${fresh.id}/disable${q}`)
          .send({ reason: '' })
      ).status,
    ).toBe(400); // a reason is required

    const damaged = await activeTag('C', '04D0D0D0D0D0D0');
    const rep = (
      await owner
        .post(`/api/v1/nfc/tags/${damaged.id}/replace${q}`)
        .send({})
        .expect(201)
    ).body;
    expect(rep.tag.status).toBe('PROVISIONING');
    expect(rep.tag.replacesId).toBe(damaged.id);
    expect(rep.tag.tableId).toBe(T.C.id);
    expect(
      (await prisma.nfcTag.findUniqueOrThrow({ where: { id: damaged.id } }))
        .status,
    ).toBe('DISABLED');
    expect(
      (
        await guest.get(
          tapUrl(damaged.ref, simulateTap(damaged.keys, damaged.uid, ctr())),
        )
      ).status,
    ).toBe(403);
  });

  it('an ordinary NFC card (BASIC) is just recorded: it holds the table QR link and has the trust of the printed QR', async () => {
    const basic = (
      await owner
        .post(`/api/v1/nfc/tags${q}`)
        .send({ tableId: T.B.id, mode: 'BASIC' })
        .expect(201)
    ).body;
    expect(basic.tag.mode).toBe('BASIC');
    expect(basic.tag.status).toBe('ACTIVE');
    expect(basic.provisioning).toBeNull();
    expect(
      (
        await guest.get(
          tapUrl(basic.tag.publicRef, { e: '0'.repeat(32), c: '0'.repeat(16) }),
        )
      ).status,
    ).toBe(403); // not a secure tap
  });

  it('staff without nfc.manage cannot create, test, rotate or disable tags, and other branches are not reachable', async () => {
    for (const [m, u] of [
      ['post', `/api/v1/nfc/tags${q}`],
      ['get', `/api/v1/nfc/tags${q}`],
      ['post', `/api/v1/nfc/tags/${a.id}/rotate${q}`],
      ['post', `/api/v1/nfc/tags/${a.id}/disable${q}`],
    ] as const) {
      expect(
        (await cashier[m](u).send({ tableId: T.A.id, reason: 'x y z' })).status,
      ).toBe(403);
    }
    expect(
      (await owner.get('/api/v1/nfc/tags?branchId=not-a-branch')).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it('the live board counts every state and each table carries a reason', async () => {
    const board = (await owner.get(`/api/v1/tables/overview${q}`).expect(200))
      .body;
    expect(Object.keys(board.counts).sort()).toEqual([
      'ACCESS_VERIFIED',
      'ATTENTION_REQUIRED',
      'CLOSED',
      'OPEN',
      'ORDER_PROCESSING',
      'PAYMENT_PENDING',
      'SETTLED',
    ]);
    expect(board.tables.length).toBeGreaterThanOrEqual(3);
    const rowA = board.tables.find((t: { id: string }) => t.id === T.A.id);
    expect(rowA.orderCount).toBeGreaterThan(0);
    expect(Number(rowA.billTotal)).toBeGreaterThan(0);
    expect(rowA.openedVia).toBe('NFC');
    expect((await cashier.get(`/api/v1/tables/overview${q}`)).status).toBe(200); // cashiers hold tables.view
  });
});
