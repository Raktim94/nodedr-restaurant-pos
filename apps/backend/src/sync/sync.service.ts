import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SyncChange {
  seq?: string;
  tbl: string;
  pk: Record<string, unknown>;
  pkKey: string;
  op: 'U' | 'D';
  row: Record<string, unknown> | null;
  ts: string;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  conflicts: { tbl: string; pk: string; error: string }[];
}

interface TableMeta {
  pk: string[];
  cols: string[];
}

type Tx = Prisma.TransactionClient;

const PULL_PAGE = 500;
const PUSH_PAGE = 200;
const MAX_FK_PASSES = 6;
const INTERVAL_MS = 30_000;
const MAX_CONFLICTS_KEPT = 50;

/**
 * Two-way sync between a local (embedded) install and a central server.
 *
 * Changes are captured by DB triggers into sync_changes (see the
 * 20261026000000_server_sync migration). Resolution is last-writer-wins per
 * row by change timestamp; on an exact tie the server's version wins. Rows
 * arrive in arbitrary table order, so a change whose parent row hasn't
 * arrived yet (FK violation) is retried in later passes.
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SyncService.name);
  private meta: Map<string, TableMeta> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$queryRawUnsafe('SELECT sync_install_triggers()');
    const envKey = process.env.SYNC_API_KEY?.trim();
    if (envKey) {
      // This process is the central server other devices sync with.
      await this.prisma.$executeRawUnsafe(
        `UPDATE sync_state SET role = 'server', enabled = true, "apiKey" = $1 WHERE id = 1`,
        envKey,
      );
      if (!(await this.state()).seeded)
        await this.prisma.$executeRawUnsafe('SELECT sync_seed()');
      this.log.log('Sync server mode enabled (SYNC_API_KEY set)');
    }
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(
        () => void this.runOnce().catch(() => undefined),
        INTERVAL_MS,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async state() {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        enabled: boolean;
        role: string;
        deviceId: string;
        serverUrl: string | null;
        apiKey: string | null;
        seeded: boolean;
        lastPullSeq: bigint;
        lastPushSeq: bigint;
        lastSyncAt: Date | null;
        lastError: string | null;
        conflicts: unknown[];
      }[]
    >(`SELECT * FROM sync_state WHERE id = 1`);
    return rows[0];
  }

  async publicStatus() {
    const s = await this.state();
    const pending = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM sync_changes WHERE seq > $1`,
      s.lastPushSeq,
    );
    return {
      enabled: s.enabled,
      role: s.role,
      serverUrl: s.serverUrl,
      hasKey: !!s.apiKey,
      lastSyncAt: s.lastSyncAt,
      lastError: s.lastError,
      pendingChanges: s.role === 'client' ? Number(pending[0].n) : 0,
      conflicts: s.conflicts,
    };
  }

  async schemaVersion(): Promise<string> {
    const r = await this.prisma.$queryRawUnsafe<{ m: string }[]>(
      `SELECT max(migration_name) AS m FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    return r[0].m;
  }

  private async tableMeta(): Promise<Map<string, TableMeta>> {
    if (this.meta) return this.meta;
    const cols = await this.prisma.$queryRawUnsafe<{ t: string; c: string }[]>(
      `SELECT c.relname AS t, a.attname AS c FROM pg_class c
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND sync_is_synced_table(c.relname)
        ORDER BY c.relname, a.attnum`,
    );
    const pks = await this.prisma.$queryRawUnsafe<{ t: string; c: string }[]>(
      `SELECT c.relname AS t, a.attname AS c FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'p' AND c.relnamespace = 'public'::regnamespace`,
    );
    const m = new Map<string, TableMeta>();
    for (const { t, c } of cols) {
      if (!m.has(t)) m.set(t, { pk: [], cols: [] });
      m.get(t)!.cols.push(c);
    }
    for (const { t, c } of pks) m.get(t)?.pk.push(c);
    this.meta = m;
    return m;
  }

  private q(id: string) {
    return `"${id.replace(/"/g, '""')}"`;
  }

  /** Newest change per row; keeps log order of the winners. */
  static compact(changes: SyncChange[]): SyncChange[] {
    const latest = new Map<string, SyncChange>();
    for (const c of changes) {
      const k = `${c.tbl}\u0000${c.pkKey}`;
      const prev = latest.get(k);
      if (!prev || Date.parse(c.ts) >= Date.parse(prev.ts)) latest.set(k, c);
    }
    return [...latest.values()];
  }

  /**
   * Applies changes with last-writer-wins. `origin` is recorded in the log
   * (so the server can relay to other devices without echoing back to the
   * sender); '__skip' applies without logging (client applying a pull).
   */
  async applyChanges(
    changes: SyncChange[],
    opts: { origin: string; tieWins: boolean },
  ): Promise<ApplyResult> {
    const meta = await this.tableMeta();
    const result: ApplyResult = { applied: 0, skipped: 0, conflicts: [] };
    let pending = SyncService.compact(changes);

    for (let pass = 0; pass < MAX_FK_PASSES && pending.length; pass++) {
      const retry: SyncChange[] = [];
      const lastError = new Map<SyncChange, string>();
      // Deletes after upserts on the first passes keeps cascades from
      // removing rows a later upsert in the same batch re-creates.
      const ordered = [...pending].sort(
        (a, b) => Number(a.op === 'D') - Number(b.op === 'D'),
      );
      for (let i = 0; i < ordered.length; i += PUSH_PAGE) {
        const slice = ordered.slice(i, i + PUSH_PAGE);
        await this.prisma.$transaction(
          async (tx) => {
            for (const c of slice) {
              await tx.$executeRawUnsafe('SAVEPOINT sp');
              try {
                const did = await this.applyOne(tx, c, meta, opts);
                if (did) result.applied++;
                else result.skipped++;
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT sp');
              } catch (e) {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp');
                const msg = e instanceof Error ? e.message : String(e);
                lastError.set(c, msg);
                if (
                  /violates foreign key|23503/.test(msg) &&
                  pass < MAX_FK_PASSES - 1
                )
                  retry.push(c);
                else
                  result.conflicts.push({
                    tbl: c.tbl,
                    pk: c.pkKey,
                    error: msg.split('\n').pop() ?? msg,
                  });
              }
            }
          },
          { timeout: 120_000, maxWait: 30_000 },
        );
      }
      pending = retry;
    }
    return result;
  }

  private async applyOne(
    tx: Tx,
    c: SyncChange,
    meta: Map<string, TableMeta>,
    opts: { origin: string; tieWins: boolean },
  ): Promise<boolean> {
    const t = meta.get(c.tbl);
    if (!t || !t.pk.length) throw new Error(`unknown table ${c.tbl}`);
    const newer = await tx.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM sync_changes WHERE tbl = $1 AND "pkKey" = $2
            AND (ts > $3::timestamptz OR (ts = $3::timestamptz AND NOT $4::boolean))) AS ok`,
      c.tbl,
      c.pkKey,
      c.ts,
      opts.tieWins,
    );
    if (!newer[0].ok) return false;
    await tx.$queryRawUnsafe(
      `SELECT set_config('app.sync_origin', $1, true), set_config('app.sync_ts', $2, true)`,
      opts.origin,
      c.ts,
    );
    const tbl = this.q(c.tbl);
    const pkCols = t.pk.map((p) => this.q(p)).join(', ');
    if (c.op === 'D') {
      await tx.$executeRawUnsafe(
        `DELETE FROM ${tbl} WHERE (${pkCols}) = (SELECT ${pkCols} FROM jsonb_populate_record(NULL::${tbl}, $1::jsonb))`,
        JSON.stringify(c.pk),
      );
    } else {
      const sets = t.cols
        .filter((x) => !t.pk.includes(x))
        .map((x) => `${this.q(x)} = EXCLUDED.${this.q(x)}`);
      const onConflict = sets.length
        ? `ON CONFLICT (${pkCols}) DO UPDATE SET ${sets.join(', ')}`
        : `ON CONFLICT (${pkCols}) DO NOTHING`;
      await tx.$executeRawUnsafe(
        `INSERT INTO ${tbl} SELECT * FROM jsonb_populate_record(NULL::${tbl}, $1::jsonb) ${onConflict}`,
        JSON.stringify(c.row),
      );
    }
    return true;
  }

  // ---- server side -------------------------------------------------------

  async pull(since: bigint, device: string, limit = PULL_PAGE) {
    const rows = await this.prisma.$queryRawUnsafe<
      {
        seq: string;
        tbl: string;
        pk: Record<string, unknown>;
        pkKey: string;
        op: 'U' | 'D';
        row: Record<string, unknown> | null;
        ts: Date;
        origin: string;
      }[]
    >(
      `SELECT seq::text, tbl, pk, "pkKey", op, row, ts, origin FROM sync_changes
        WHERE seq > $1 ORDER BY seq LIMIT $2`,
      since,
      limit,
    );
    const nextSeq = rows.length ? rows[rows.length - 1].seq : since.toString();
    const mine = rows
      .filter((r) => r.origin !== device)
      .map((r) => ({ ...r, ts: r.ts.toISOString() }));
    return {
      changes: SyncService.compact(mine),
      nextSeq,
      hasMore: rows.length === limit,
    };
  }

  async push(device: string, changes: SyncChange[]) {
    return this.applyChanges(changes, { origin: device, tieWins: false });
  }

  // ---- client side -------------------------------------------------------

  private async call<T>(
    s: { serverUrl: string | null; apiKey: string | null },
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!s.serverUrl || !s.apiKey)
      throw new Error('Server address and sync key are required');
    const res = await fetch(
      `${s.serverUrl.replace(/\/+$/, '')}/api/v1/sync-peer/${path}`,
      {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-sync-key': s.apiKey,
          ...init.headers,
        },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (res.status === 401 || res.status === 403)
      throw new Error('Server rejected the sync key');
    if (!res.ok) throw new Error(`Server answered HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async testConnection(serverUrl: string, apiKey: string) {
    const r = await this.call<{ ok: boolean; role: string; schema: string }>(
      { serverUrl, apiKey },
      'ping',
    );
    const local = await this.schemaVersion();
    if (r.role !== 'server')
      throw new Error(
        'That address is not a sync server (SYNC_API_KEY is not set there)',
      );
    if (r.schema !== local) {
      throw new Error(
        `App versions differ (this PC: ${local}, server: ${r.schema}). Update both to the same version first.`,
      );
    }
    return { ok: true, schema: r.schema };
  }

  /** mode 'adopt': replace local data with the server's. 'merge': keep and merge both. */
  async enable(serverUrl: string, apiKey: string, mode: 'adopt' | 'merge') {
    // A cycle already in flight holds the previous sequence numbers.
    await this.running?.catch(() => undefined);
    await this.testConnection(serverUrl, apiKey);
    const meta = await this.tableMeta();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE sync_state SET enabled = false, role = 'client', "serverUrl" = $1, "apiKey" = $2,
             "lastPullSeq" = 0, "lastPushSeq" = 0, "lastError" = NULL, conflicts = '[]' WHERE id = 1`,
          serverUrl.replace(/\/+$/, ''),
          apiKey,
        );
        await tx.$executeRawUnsafe('DELETE FROM sync_changes');
        if (mode === 'adopt') {
          await tx.$queryRawUnsafe(
            `SELECT set_config('app.sync_origin', '__skip', true)`,
          );
          // The append-only VERI*FACTU chain can't be replaced; an empty one
          // only needs its truncate guard stepped around.
          const chain = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM verifactu_records`,
          );
          if (Number(chain[0].n) > 0) {
            throw new Error(
              'This PC already has VERI*FACTU invoice records, which cannot be replaced. Use "merge" instead.',
            );
          }
          await tx.$executeRawUnsafe(
            `ALTER TABLE verifactu_records DISABLE TRIGGER USER`,
          );
          const tables = [...meta.keys()].map((t) => this.q(t)).join(', ');
          await tx.$executeRawUnsafe(
            `TRUNCATE ${tables}, verifactu_records CASCADE`,
          );
          await tx.$executeRawUnsafe(
            `ALTER TABLE verifactu_records ENABLE TRIGGER USER`,
          );
        }
        await tx.$executeRawUnsafe(
          `UPDATE sync_state SET enabled = true, seeded = ${mode === 'adopt'} WHERE id = 1`,
        );
        if (mode === 'merge') await tx.$executeRawUnsafe('SELECT sync_seed()');
      },
      { timeout: 120_000 },
    );
    return this.runOnce();
  }

  async disable() {
    await this.running?.catch(() => undefined);
    await this.prisma.$executeRawUnsafe(
      `UPDATE sync_state SET enabled = false, "lastError" = NULL WHERE id = 1 AND role = 'client'`,
    );
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM sync_changes WHERE (SELECT role FROM sync_state) = 'client'`,
    );
  }

  runOnce(): Promise<{
    pulled: number;
    pushed: number;
    conflicts: number;
  } | null> {
    if (this.running) return this.running as Promise<never>;
    const p = this.cycle().finally(() => {
      this.running = null;
    });
    this.running = p;
    return p;
  }

  private async cycle() {
    const s = await this.state();
    if (!s.enabled || s.role !== 'client') return null;
    let pulled = 0;
    let pushed = 0;
    const conflicts: ApplyResult['conflicts'] = [];
    try {
      await this.testConnection(s.serverUrl!, s.apiKey!);

      let since = s.lastPullSeq;
      for (;;) {
        const page = await this.call<{
          changes: SyncChange[];
          nextSeq: string;
          hasMore: boolean;
        }>(s, `pull?since=${since}&device=${encodeURIComponent(s.deviceId)}`);
        const r = await this.applyChanges(page.changes, {
          origin: '__skip',
          tieWins: true,
        });
        pulled += r.applied;
        conflicts.push(...r.conflicts);
        since = BigInt(page.nextSeq);
        await this.prisma.$executeRawUnsafe(
          `UPDATE sync_state SET "lastPullSeq" = $1 WHERE id = 1`,
          since,
        );
        if (!page.hasMore) break;
      }

      let pushedTo = s.lastPushSeq;
      for (;;) {
        const rows = await this.prisma.$queryRawUnsafe<
          {
            seq: string;
            tbl: string;
            pk: Record<string, unknown>;
            pkKey: string;
            op: 'U' | 'D';
            row: Record<string, unknown> | null;
            ts: Date;
          }[]
        >(
          `SELECT seq::text, tbl, pk, "pkKey", op, row, ts FROM sync_changes WHERE seq > $1 ORDER BY seq LIMIT $2`,
          pushedTo,
          PUSH_PAGE,
        );
        if (!rows.length) break;
        const changes = SyncService.compact(
          rows.map((r) => ({ ...r, ts: r.ts.toISOString() })),
        );
        const r = await this.call<ApplyResult>(s, 'push', {
          method: 'POST',
          body: JSON.stringify({ device: s.deviceId, changes }),
        });
        pushed += r.applied;
        conflicts.push(...r.conflicts);
        pushedTo = BigInt(rows[rows.length - 1].seq);
        await this.prisma.$executeRawUnsafe(
          `UPDATE sync_state SET "lastPushSeq" = $1 WHERE id = 1`,
          pushedTo,
        );
        if (rows.length < PUSH_PAGE) break;
      }

      const kept = [
        ...conflicts.map((c) => ({ ...c, at: new Date().toISOString() })),
        ...(s.conflicts ?? []),
      ].slice(0, MAX_CONFLICTS_KEPT);
      await this.prisma.$executeRawUnsafe(
        `UPDATE sync_state SET "lastSyncAt" = now(), "lastError" = NULL, conflicts = $1::jsonb WHERE id = 1`,
        JSON.stringify(kept),
      );
      // Everything up to lastPushSeq is on the server; keep the log small.
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM sync_changes WHERE seq <= (SELECT "lastPushSeq" FROM sync_state) AND ts < now() - interval '1 day'`,
      );
      return { pulled, pushed, conflicts: conflicts.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`sync failed: ${msg}`);
      await this.prisma.$executeRawUnsafe(
        `UPDATE sync_state SET "lastError" = $1 WHERE id = 1`,
        msg,
      );
      throw e;
    }
  }
}
