-- Two-way server sync: a generic row-level change log written by triggers on
-- every business table, so new tables are covered without per-model code.
-- Nothing is logged until sync_state.enabled is true (plain installs pay only
-- one indexed single-row lookup per write).

CREATE TABLE "sync_state" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "role" TEXT NOT NULL DEFAULT 'client',
  "deviceId" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  "serverUrl" TEXT,
  "apiKey" TEXT,
  "seeded" BOOLEAN NOT NULL DEFAULT false,
  "lastPullSeq" BIGINT NOT NULL DEFAULT 0,
  "lastPushSeq" BIGINT NOT NULL DEFAULT 0,
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "conflicts" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "sync_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sync_state_single" CHECK ("id" = 1)
);
INSERT INTO "sync_state" ("id") VALUES (1);

CREATE TABLE "sync_changes" (
  "seq" BIGSERIAL NOT NULL,
  "tbl" TEXT NOT NULL,
  "pk" JSONB NOT NULL,
  "pkKey" TEXT NOT NULL,
  "op" CHAR(1) NOT NULL,
  "row" JSONB,
  "ts" TIMESTAMPTZ(3) NOT NULL,
  "origin" TEXT NOT NULL,
  CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("seq")
);
CREATE INDEX "sync_changes_row_idx" ON "sync_changes"("tbl", "pkKey");

-- Tables that never sync: bookkeeping, per-device backups, delivery logs, and
-- the VERI*FACTU invoice chain (append-only and hash-chained per installation,
-- so it cannot be merged across devices).
CREATE OR REPLACE FUNCTION sync_is_synced_table(t text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT t NOT LIKE 'sync\_%' AND t NOT IN
    ('_prisma_migrations', 'backups', 'backup_config', 'webhook_deliveries', 'download_stats', 'verifactu_records')
$$;

CREATE OR REPLACE FUNCTION sync_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origin text := coalesce(current_setting('app.sync_origin', true), '');
  en boolean;
  rec jsonb;
  pkv jsonb := '{}';
  c text;
  ts timestamptz;
BEGIN
  IF origin = '__skip' THEN RETURN NULL; END IF;
  SELECT enabled INTO en FROM sync_state WHERE id = 1;
  IF NOT coalesce(en, false) THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN rec := to_jsonb(OLD); ELSE rec := to_jsonb(NEW); END IF;
  FOREACH c IN ARRAY TG_ARGV LOOP
    pkv := pkv || jsonb_build_object(c, rec -> c);
  END LOOP;
  ts := coalesce(nullif(current_setting('app.sync_ts', true), '')::timestamptz, clock_timestamp());
  INSERT INTO sync_changes (tbl, pk, "pkKey", op, row, ts, origin)
  VALUES (TG_TABLE_NAME, pkv, pkv::text,
          CASE WHEN TG_OP = 'DELETE' THEN 'D' ELSE 'U' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE rec END,
          ts, CASE WHEN origin = '' THEN 'local' ELSE origin END);
  RETURN NULL;
END $$;

-- Idempotent; also called at every boot so tables added by later migrations
-- get covered.
CREATE OR REPLACE FUNCTION sync_install_triggers() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname,
           (SELECT string_agg(quote_literal(a.attname), ',' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = ANY (k.conkey)) AS pkargs
      FROM pg_class c JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND sync_is_synced_table(c.relname)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = r.oid AND tgname = 'sync_log') THEN
      EXECUTE format('CREATE TRIGGER sync_log AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_log_change(%s)', r.relname, r.pkargs);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- Writes every existing row into the log (ts = epoch so any real edit wins).
CREATE OR REPLACE FUNCTION sync_seed() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname,
           (SELECT string_agg(format('%L, t.%I', a.attname, a.attname), ',' ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = ANY (k.conkey)) AS pkexpr
      FROM pg_class c JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND sync_is_synced_table(c.relname)
  LOOP
    EXECUTE format(
      'INSERT INTO sync_changes (tbl, pk, "pkKey", op, row, ts, origin)
         SELECT %L, jsonb_build_object(%s), jsonb_build_object(%s)::text, ''U'', to_jsonb(t), ''epoch'', ''seed'' FROM %I t',
      r.relname, r.pkexpr, r.pkexpr, r.relname);
  END LOOP;
  UPDATE sync_state SET seeded = true WHERE id = 1;
END $$;

SELECT sync_install_triggers();
