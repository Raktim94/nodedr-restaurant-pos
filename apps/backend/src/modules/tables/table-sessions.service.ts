import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

// Live table sessions.
//
// Threat: a table's printed QR is a public locator (it is photographed, shared, scanned from home). It must never be
// enough, by itself, to place a dine-in order. Staff open a session for the table; the server makes a short code that
// is shown to staff ONCE (never stored: only its SHA-256), staff pass it to the guests (say it, print it on a slip, or
// show it on the customer screen). The guest's phone trades the code for a random bearer grant (stored only as a hash,
// bound to that one session). Orders must carry the grant. Closing the session (staff, table cleared after payment, or
// expiry) makes every grant and old code useless. Wrong codes are counted per session and lock it for a while.
// This does not stop a person who is really at the table from sharing the code with a friend elsewhere, or someone
// inside the restaurant from ordering for the wrong table; it stops anonymous remote orders from a static QR.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LENGTH = 6;
const DEFAULT_HOURS = 4;
const MAX_FAILS = 8; // wrong codes from ONE source before that source is blocked
const SESSION_MAX_FAILS = 60; // wrong codes from ALL sources together before the session itself locks (distributed guessing)
const LOCK_MS = 10 * 60_000;
const JOIN_WINDOW_MS = 30_000; // the join QR changes every 30 s; the current and the previous one are accepted (30-60 s of life)
const MAX_GRANTS_PER_SESSION = 60; // a table has a handful of guests; this stops a relayed code from being farmed
const ACCESS_MINUTES = 30; // how long a verified tag tap stays good for placing the first order

// Wrong-code blocks are kept per (session, source). A single phone or script that keeps guessing blocks only itself:
// it can no longer lock every real guest out of a table with the static QR. In memory on purpose: a restart only
// forgives a blocked source, while the session-wide limit below is stored in the database.
const sourceFails = new Map<string, { fails: number; until: number }>();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const macOf = (secret: string, sessionId: string, window: number) =>
  createHmac('sha256', secret)
    .update(`join:${sessionId}:${window}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
const normalise = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export class SessionError extends HttpException {
  constructor(
    message: string,
    code:
      | 'TABLE_SESSION_REQUIRED'
      | 'TABLE_SESSION_EXPIRED'
      | 'TABLE_SESSION_BAD_CODE'
      | 'TABLE_SESSION_LOCKED',
    status = HttpStatus.FORBIDDEN,
  ) {
    super({ message, code, statusCode: status }, status);
  }
}

@Injectable()
export class TableSessionsService {
  private readonly logger = new Logger(TableSessionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private makeCode() {
    return Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
  }

  /** Staff: open (or reset) the session for a table. Any earlier session is closed at once, so old codes stop working. */
  async open(
    branchId: string,
    tableId: string,
    userId: string,
    hours = DEFAULT_HOURS,
  ) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, floor: { branchId } },
      select: { id: true, number: true },
    });
    if (!table) throw new NotFoundException('Table not found');
    const h = Math.min(12, Math.max(1, Math.floor(hours)));
    const code = this.makeCode();
    const s = await this.prisma.$transaction(async (tx) => {
      await tx.tableSession.updateMany({
        where: { tableId, status: 'ACTIVE' },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedReason: 'Reset by staff',
        },
      });
      return tx.tableSession.create({
        data: {
          branchId,
          tableId,
          codeHash: sha(code),
          joinSecret: randomBytes(32).toString('hex'),
          openedById: userId,
          expiresAt: new Date(Date.now() + h * 3_600_000),
        },
      });
    });
    await this.audit.record({
      userId,
      action: 'table_session.opened',
      entity: 'Table',
      entityId: tableId,
      metadata: { sessionId: s.id, hours: h },
    });
    // The code is returned this once. It is not recoverable: if lost, staff reset the session.
    return {
      sessionId: s.id,
      tableNumber: table.number,
      code,
      expiresAt: s.expiresAt,
    };
  }

  async close(
    branchId: string,
    tableId: string,
    userId: string,
    reason = 'Closed by staff',
  ) {
    const r = await this.prisma.tableSession.updateMany({
      where: { tableId, branchId, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: new Date(), closedReason: reason },
    });
    if (r.count > 0)
      await this.audit.record({
        userId,
        action: 'table_session.closed',
        entity: 'Table',
        entityId: tableId,
        metadata: { reason },
      });
    return { closed: r.count > 0 };
  }

  /**
   * Staff/display: the join token for the table's live session. It is an HMAC of (session, 30-second window) under a
   * per-session secret, so it names no customer, payment or staff data, cannot be guessed, expires by itself, and dies
   * with the session. A guest scanning it receives their own limited grant (many guests can scan the same QR).
   */
  async currentJoinToken(branchId: string, tableId: string) {
    const s = await this.active(tableId);
    if (!s || s.branchId !== branchId)
      throw new NotFoundException('This table is not open. Open it first.');
    let secret = s.joinSecret;
    if (!secret) {
      secret = randomBytes(32).toString('hex');
      const r = await this.prisma.tableSession.updateMany({
        where: { id: s.id, joinSecret: null },
        data: { joinSecret: secret },
      });
      if (r.count === 0) {
        secret =
          (
            await this.prisma.tableSession.findUniqueOrThrow({
              where: { id: s.id },
              select: { joinSecret: true },
            })
          ).joinSecret ?? secret;
      }
    }
    const now = Date.now();
    const window = Math.floor(now / JOIN_WINDOW_MS);
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { qrToken: true, number: true },
    });
    return {
      token: `${window.toString(36)}.${macOf(secret, s.id, window)}`,
      qrToken: table?.qrToken ?? null,
      tableNumber: table?.number ?? null,
      refreshInSeconds: Math.max(
        1,
        Math.ceil(((window + 1) * JOIN_WINDOW_MS - now) / 1000),
      ),
      sessionExpiresAt: s.expiresAt,
    };
  }

  /** A guest scanned the rotating QR. Valid only for this table's live session and only within its short window. */
  async joinWithToken(tableId: string, rawToken: string, source = 'unknown') {
    const s = await this.active(tableId);
    if (!s)
      throw new SessionError(
        'This table is not open for ordering yet. Please ask the staff to open it.',
        'TABLE_SESSION_EXPIRED',
      );
    const key = `tok|${s.id}|${source}`;
    const mine = sourceFails.get(key);
    if (mine && mine.until > Date.now())
      throw new SessionError(
        'Too many attempts. Please ask the staff for help.',
        'TABLE_SESSION_LOCKED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const [w, mac] = String(rawToken ?? '')
      .slice(0, 80)
      .split('.');
    const window = Number.parseInt(w ?? '', 36);
    const nowWindow = Math.floor(Date.now() / JOIN_WINDOW_MS);
    const fresh =
      !!s.joinSecret &&
      Number.isInteger(window) &&
      !!mac &&
      nowWindow - window >= 0 &&
      nowWindow - window <= 1 &&
      same(mac, macOf(s.joinSecret, s.id, window));
    if (!fresh) {
      if (sourceFails.size > 5000) sourceFails.clear();
      const fails = (mine && mine.until === 0 ? mine.fails : 0) + 1;
      sourceFails.set(
        key,
        fails >= MAX_FAILS
          ? { fails: 0, until: Date.now() + LOCK_MS }
          : { fails, until: 0 },
      );
      this.logger.warn(
        `Table session ${s.id}: invalid or expired join QR (table ${tableId})`,
      );
      throw new SessionError(
        'That QR has expired. Please scan the code on the table screen again.',
        'TABLE_SESSION_BAD_CODE',
      );
    }
    sourceFails.delete(key);
    const issued = await this.prisma.tableSessionGrant.count({
      where: { sessionId: s.id },
    });
    if (issued >= MAX_GRANTS_PER_SESSION) {
      this.logger.warn(
        `Table session ${s.id}: grant limit reached, refusing another join`,
      );
      throw new SessionError(
        'Too many phones have joined this table. Please ask the staff for help.',
        'TABLE_SESSION_LOCKED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.tableSessionGrant.create({
      data: { sessionId: s.id, tokenHash: sha(token) },
    });
    return { token, expiresAt: s.expiresAt };
  }

  /** Called when a table is cleared (bill paid, table set free): the next guests need a fresh code. */
  async closeForTable(tableId: string, reason = 'Table cleared') {
    await this.prisma.tableSession.updateMany({
      where: { tableId, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: new Date(), closedReason: reason },
    });
  }

  async list(branchId: string) {
    const rows = await this.prisma.tableSession.findMany({
      where: { branchId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: { openedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      tableId: r.tableId,
      openedAt: r.openedAt,
      expiresAt: r.expiresAt,
      locked: !!r.lockedUntil && r.lockedUntil > new Date(),
    }));
  }

  private async active(tableId: string) {
    const candidates = await this.prisma.tableSession.findMany({
      where: { tableId, status: 'ACTIVE' },
      orderBy: { openedAt: 'desc' },
      take: 3,
    });
    for (const s of candidates) if (await this.isLive(s)) return s;
    return null;
  }

  /**
   * A session is live while it is unexpired OR the table still has an unpaid order. A timer alone never ends a session
   * that someone still owes money on: it ends when the last order is settled (see OrdersService) or staff close it.
   */
  async isLive(s: {
    tableId: string;
    status: string;
    expiresAt: Date;
  }): Promise<boolean> {
    if (s.status !== 'ACTIVE') return false;
    if (s.expiresAt > new Date()) return true;
    return (
      (await this.prisma.order.count({
        where: { tableId: s.tableId, status: 'OPEN' },
      })) > 0
    );
  }

  /** Whether the table has a live session (staff-opened or automatic). */
  async hasLive(tableId: string): Promise<boolean> {
    return (await this.active(tableId)) !== null;
  }

  /**
   * A phone proves it is at this table (a verified tag tap). Short-lived, random, stored only as a hash. It does NOT open
   * the table: the first valid order does, and the phone then receives a session grant like any other guest.
   */
  async issueAccess(
    tableId: string,
    tagId: string | null,
    minutes = ACCESS_MINUTES,
  ) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    await this.prisma.tableAccess.create({
      data: { tableId, tagId, tokenHash: sha(token), expiresAt },
    });
    return { token, expiresAt };
  }

  async assertAccess(tableId: string, token: string | undefined) {
    const need = () =>
      new SessionError(
        'To order from your table, tap the table tag or enter the table code the staff gave you.',
        'TABLE_SESSION_REQUIRED',
      );
    if (!token) throw need();
    const row = await this.prisma.tableAccess.findUnique({
      where: { tokenHash: sha(token) },
    });
    if (!row || row.tableId !== tableId) throw need();
    if (row.expiresAt <= new Date()) {
      throw new SessionError(
        'That tap has expired. Please tap the table tag again.',
        'TABLE_SESSION_EXPIRED',
      );
    }
    await this.prisma.tableAccess.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    return row;
  }

  async hasVerifiedAccess(tableId: string): Promise<boolean> {
    return (
      (await this.prisma.tableAccess.count({
        where: { tableId, expiresAt: { gt: new Date() } },
      })) > 0
    );
  }

  /**
   * Opens the table's session when the first valid guest order is accepted, once, however many guests order at the
   * same moment (a per-table advisory lock inside one transaction). Further guests join the session that exists.
   */
  async ensureSession(
    branchId: string,
    tableId: string,
    via: 'NFC' | 'GUEST_ORDER' = 'GUEST_ORDER',
    hours = DEFAULT_HOURS,
  ) {
    const { session, created } = await this.prisma.$transaction(async (tx) => {
      // A transaction-scoped lock on this table (executeRaw: pg_advisory_xact_lock returns void).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'table-session:' + tableId}))`;
      const existing = await tx.tableSession.findMany({
        where: { tableId, status: 'ACTIVE' },
        orderBy: { openedAt: 'desc' },
        take: 3,
      });
      for (const s of existing) {
        if (
          s.expiresAt > new Date() ||
          (await tx.order.count({ where: { tableId, status: 'OPEN' } })) > 0
        )
          return { session: s, created: false };
      }
      await tx.tableSession.updateMany({
        where: { tableId, status: 'ACTIVE' },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedReason: 'Expired with nothing owed',
        },
      });
      const made = await tx.tableSession.create({
        data: {
          branchId,
          tableId,
          // There is no code to enter: guests got in by tapping the tag, so this hash matches nothing anyone can type.
          codeHash: sha(randomBytes(32).toString('hex')),
          openedById: null,
          openedVia: via,
          expiresAt: new Date(
            Date.now() + Math.min(12, Math.max(1, hours)) * 3_600_000,
          ),
        },
      });
      return { session: made, created: true };
    });
    if (created) {
      await this.audit.record({
        userId: null,
        action: 'table_session.opened',
        entity: 'Table',
        entityId: tableId,
        metadata: { sessionId: session.id, via },
      });
    }
    return session;
  }

  /** A grant for a session the guest did not unlock with the staff code (they tapped in and their order opened or joined it). */
  async grantFor(sessionId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.tableSessionGrant.create({
      data: { sessionId, tokenHash: sha(token) },
    });
    return token;
  }

  /** The guest enters the code shown by staff. Returns a bearer grant for this session. */
  async join(tableId: string, rawCode: string, source = 'unknown') {
    const s = await this.active(tableId);
    if (!s)
      throw new SessionError(
        'This table is not open for ordering yet. Please ask the staff to open it and give you the table code.',
        'TABLE_SESSION_EXPIRED',
      );
    if (s.lockedUntil && s.lockedUntil > new Date())
      throw new SessionError(
        'Too many wrong codes. Please ask the staff for help.',
        'TABLE_SESSION_LOCKED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const key = `${s.id}|${source}`;
    const mine = sourceFails.get(key);
    if (mine && mine.until > Date.now())
      throw new SessionError(
        'Too many wrong codes. Please ask the staff for help.',
        'TABLE_SESSION_LOCKED',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const code = normalise(rawCode ?? '');
    if (code.length !== CODE_LENGTH || !same(sha(code), s.codeHash)) {
      if (sourceFails.size > 5000) sourceFails.clear();
      const fails = (mine && mine.until === 0 ? mine.fails : 0) + 1;
      sourceFails.set(
        key,
        fails >= MAX_FAILS
          ? { fails: 0, until: Date.now() + LOCK_MS }
          : { fails, until: 0 },
      );
      // Atomic, so concurrent guesses are all counted. Logged without the code that was tried.
      const row = await this.prisma.tableSession.update({
        where: { id: s.id },
        data: { failedTries: { increment: 1 } },
        select: { failedTries: true },
      });
      if (row.failedTries >= SESSION_MAX_FAILS) {
        await this.prisma.tableSession.update({
          where: { id: s.id },
          data: { failedTries: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
        });
        this.logger.warn(
          `Table session ${s.id}: ${SESSION_MAX_FAILS} wrong codes from many sources, locked for 10 minutes`,
        );
        await this.audit.record({
          userId: null,
          action: 'table_session.locked',
          entity: 'Table',
          entityId: tableId,
          metadata: { sessionId: s.id },
        });
      }
      throw new SessionError(
        'That code is not right. Please check it with the staff.',
        'TABLE_SESSION_BAD_CODE',
      );
    }
    sourceFails.delete(key);
    const token = randomBytes(32).toString('base64url');
    await this.prisma.tableSessionGrant.create({
      data: { sessionId: s.id, tokenHash: sha(token) },
    });
    await this.prisma.tableSession.update({
      where: { id: s.id },
      data: { failedTries: 0 },
    });
    return { token, expiresAt: s.expiresAt };
  }

  /** Orders and requests must carry the grant. Throws the error the guest's page knows how to explain. */
  async assertGrant(tableId: string, token: string | undefined) {
    if (!token)
      throw new SessionError(
        'To order from your table, enter the table code the staff gave you.',
        'TABLE_SESSION_REQUIRED',
      );
    const grant = await this.prisma.tableSessionGrant.findUnique({
      where: { tokenHash: sha(token) },
      include: { session: true },
    });
    const s = grant?.session;
    if (!s || s.tableId !== tableId)
      throw new SessionError(
        'To order from your table, enter the table code the staff gave you.',
        'TABLE_SESSION_REQUIRED',
      );
    if (!(await this.isLive(s)))
      throw new SessionError(
        'Your table session has ended. Please ask the staff for a new table code.',
        'TABLE_SESSION_EXPIRED',
      );
    return s;
  }

  /** What the guest's page needs to decide what to show (no secrets). */
  async publicState(tableId: string, token: string | undefined) {
    const s = await this.active(tableId);
    let valid = false;
    if (s && token) {
      const g = await this.prisma.tableSessionGrant.findUnique({
        where: { tokenHash: sha(token) },
      });
      valid = !!g && g.sessionId === s.id;
    }
    return { open: !!s, valid };
  }

  bad(msg: string): never {
    throw new BadRequestException(msg);
  }
  forbid(msg: string): never {
    throw new ForbiddenException(msg);
  }
}
