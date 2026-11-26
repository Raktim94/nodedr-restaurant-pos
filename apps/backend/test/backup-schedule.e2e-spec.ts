// Run on a fresh, migrated PostgreSQL test database with BACKUP_SCHEDULE_E2E=1.
// The test creates an instance schedule and refuses to use existing backup data.
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SessionUser } from '@nodedr-restaurant/types';
import { AuditService } from '../src/audit/audit.service';
import { BackupService } from '../src/backup/backup.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';

const run = process.env.BACKUP_SCHEDULE_E2E === '1' ? describe : describe.skip;

run('instance backup scheduling (PostgreSQL)', () => {
  let prisma: PrismaService;
  let clean = false;
  let previousEnv: NodeJS.ProcessEnv;
  const user = { id: 'test-operator' } as SessionUser;
  const notifications: Pick<NotificationsService, 'notifyUser'> = {
    notifyUser: () => Promise.resolve(),
  };
  function worker() {
    return new BackupService(
      prisma,
      { record: jest.fn() } as unknown as AuditService,
      notifications as NotificationsService,
    );
  }
  const scheduleError = jest.fn<void, [string]>();
  function failingWorker() {
    const service = worker();
    jest.spyOn(service['logger'], 'error').mockImplementation(scheduleError);
    return service;
  }
  function expectScheduleError(expected: string | RegExp) {
    expect(scheduleError).toHaveBeenCalledTimes(1);
    expect(scheduleError.mock.calls[0][0]).toMatch(expected);
  }
  const dumpFailure = /^Scheduled backup failed: .*pg_dump/;
  beforeEach(() => {
    scheduleError.mockClear();
  });
  const calendar = { mode: 'daily', time: '07:15', timeZone: 'UTC' } as const;
  beforeAll(async () => {
    previousEnv = process.env;
    prisma = new PrismaService({ datasourceUrl: process.env.DATABASE_URL });
    await prisma.$connect();
    const counts = await Promise.all([
      prisma.backup.count(),
      prisma.backupConfig.count(),
      prisma.backupScheduleState.count(),
    ]);
    if (counts.some(Boolean)) throw new Error('Use an empty test database');
    clean = true;
    process.env = {
      ...previousEnv,
      S3_BACKUP_ENDPOINT: 'http://127.0.0.1:1',
      JWT_SECRET: 'test-backup-schedule-key-only',
      S3_BACKUP_BUCKET: 'test',
      S3_BACKUP_ACCESS_KEY_ID: 'test',
      S3_BACKUP_SECRET_ACCESS_KEY: 'test',
      S3_BACKUP_INTERVAL_DAYS: '6',
      S3_BACKUP_RETAIN_COUNT: '4',
      // pg_dump must fail before reaching S3. Prisma uses its explicit URL above.
      DATABASE_URL: 'postgresql://test@127.0.0.1:1/missing',
    };
  });
  afterEach(async () => {
    if (!clean) return;
    await prisma.backupScheduleState.deleteMany();
    await prisma.backup.deleteMany();
    await prisma.backupConfig.deleteMany();
  });
  afterAll(async () => {
    process.env = previousEnv;
    await prisma?.$disconnect();
  });

  it('keeps the backup schedule and worker lease out of cross-server sync', async () => {
    const [policy] = await prisma.$queryRaw<{ sync: boolean }[]>`
      SELECT sync_is_synced_table('backup_schedule_state') AS sync
    `;
    expect(policy.sync).toBe(false);
  });

  it('preserves environmental cadence and retention when promoting or rotating credentials', async () => {
    const s3: { send(command: unknown): Promise<unknown> } = S3Client.prototype;
    const probe = jest
      .spyOn(s3, 'send')
      .mockImplementation((command: unknown) =>
        Promise.resolve(
          command instanceof GetObjectCommand
            ? { Body: Readable.from([Buffer.from('ok')]) }
            : {},
        ),
      );
    const service = worker();
    const creds = {
      endpoint: 'http://127.0.0.1:1',
      bucket: 'new',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    };
    try {
      expect(await service.setConfig(user, creds)).toMatchObject({
        source: 'database',
        intervalDays: 6,
        retainCount: 4,
      });
      await service.setSchedule(user, { schedule: calendar, retainCount: 8 });
      expect(
        await service.setConfig(user, { ...creds, secretAccessKey: 'rotated' }),
      ).toMatchObject({ schedule: calendar, retainCount: 8 });
      expect(
        await service.setConfig(user, {
          ...creds,
          intervalDays: 2,
          retainCount: 1,
        }),
      ).toMatchObject({
        schedule: { mode: 'interval', intervalDays: 2 },
        retainCount: 1,
      });
    } finally {
      probe.mockRestore();
    }
  });

  it.each(['increase', 'disconnect', 'change bucket'])(
    'uses current retention before deleting after a mid-run %s',
    async (change) => {
      const service = worker();
      await service.setSchedule(user, { schedule: calendar, retainCount: 1 });
      const started = await service['requireConfig']();
      const bucket = process.env.S3_BACKUP_BUCKET;
      try {
        await prisma.backup.createMany({
          data: [
            { status: 'VERIFIED', verifiedAt: new Date(0) },
            { status: 'VERIFIED', verifiedAt: new Date() },
          ],
        });
        if (change === 'increase')
          await service.setSchedule(user, {
            schedule: calendar,
            retainCount: 5,
          });
        else if (change === 'disconnect') delete process.env.S3_BACKUP_BUCKET;
        else process.env.S3_BACKUP_BUCKET = 'different';
        await service['enforceRetention'](started);
        expect(await prisma.backup.count()).toBe(2);
      } finally {
        process.env.S3_BACKUP_BUCKET = bucket;
      }
    },
  );

  it('preserves live claims across edits and reaps an abandoned run before retrying the legacy interval', async () => {
    const service = failingWorker();
    const attempt = await prisma.backup.create({
      data: { status: 'PENDING', createdAt: new Date('2000-01-01') },
    });
    await prisma.backupScheduleState.create({
      data: {
        id: 'singleton',
        lastAttemptId: attempt.id,
        leaseUntil: new Date(Date.now() + 300000),
      },
    });
    await service.setSchedule(user, {
      schedule: { mode: 'interval', intervalDays: 30 },
      retainCount: 2,
    });
    await service.checkSchedule();
    expect(await prisma.backup.findMany()).toMatchObject([
      { id: attempt.id, status: 'PENDING' },
    ]);
    await prisma.backupScheduleState.update({
      where: { id: 'singleton' },
      data: { leaseUntil: new Date(0) },
    });
    await Promise.all([
      service.checkSchedule(),
      failingWorker().checkSchedule(),
    ]);
    expect(
      await prisma.backup.findUnique({ where: { id: attempt.id } }),
    ).toMatchObject({ status: 'FAILED' });
    expect(await prisma.backup.count()).toBe(2);
    expectScheduleError(dumpFailure);
  });

  it('renews the lease during a slow dump so a second worker cannot reclaim it', async () => {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const temp = jest.spyOn(fs, 'mkdtemp').mockImplementationOnce(async () => {
      enter();
      await wait;
      throw new Error('end test dump');
    });
    // Run only the scheduler heartbeat faster. Prisma and promises use real time.
    const realInterval = global.setInterval;
    const ticks = jest
      .spyOn(global, 'setInterval')
      .mockImplementation((fn: () => void, delay: number) =>
        realInterval(fn, delay === 60000 ? 10 : delay),
      );
    const running = failingWorker().checkSchedule();
    try {
      await entered;
      const nearExpiry = new Date(Date.now() + 1_000);
      await prisma.backupScheduleState.update({
        where: { id: 'singleton' },
        data: { leaseUntil: nearExpiry },
      });
      let until = nearExpiry;
      while (until <= nearExpiry && Date.now() < nearExpiry.getTime()) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        until = (
          await prisma.backupScheduleState.findUniqueOrThrow({
            where: { id: 'singleton' },
          })
        ).leaseUntil!;
      }
      expect(until.getTime()).toBeGreaterThan(nearExpiry.getTime());
      await worker().checkSchedule();
      expect(await prisma.backup.count()).toBe(1);
    } finally {
      release();
      await running;
      temp.mockRestore();
      ticks.mockRestore();
    }
    expectScheduleError('Scheduled backup failed: end test dump');
  });

  it('inherits environment defaults, keeps overdue work on a retention edit, and replaces it on a schedule edit', async () => {
    const service = worker();
    expect(await service.status()).toMatchObject({
      source: 'environment',
      schedule: { mode: 'interval', intervalDays: 6 },
      retainCount: 4,
    });
    const saved = await service.setSchedule(user, {
      schedule: calendar,
      retainCount: 3,
    });
    expect(saved.nextScheduledAt!.getTime()).toBeGreaterThan(Date.now());
    const missed = new Date('2000-01-01T07:15:00Z');
    await prisma.backupScheduleState.update({
      where: { id: 'singleton' },
      data: { nextScheduledAt: missed },
    });
    expect(
      (await service.setSchedule(user, { schedule: calendar, retainCount: 5 }))
        .nextScheduledAt,
    ).toEqual(missed);
    const changed = await service.setSchedule(user, {
      schedule: { ...calendar, time: '08:45' },
      retainCount: 5,
    });
    expect(changed.nextScheduledAt!.getUTCHours()).toBe(8);
    expect(changed.nextScheduledAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await worker().status()).toEqual(changed);
    expect(await service.clearConfig(user)).toMatchObject({
      schedule: { mode: 'interval', intervalDays: 6 },
      retainCount: 4,
    });
  });

  it('coalesces missed slots and allows exactly one attempt across concurrent and restarted workers, even on failure', async () => {
    await worker().setSchedule(user, { schedule: calendar, retainCount: 3 });
    await prisma.backupScheduleState.update({
      where: { id: 'singleton' },
      data: { nextScheduledAt: new Date('2000-01-01T07:15:00Z') },
    });
    await Promise.all([
      failingWorker().checkSchedule(),
      failingWorker().checkSchedule(),
    ]);
    await worker().checkSchedule();
    expect(await prisma.backup.findMany()).toMatchObject([
      { status: 'FAILED', triggeredById: null },
    ]);
    const status = await worker().status();
    expect(status.nextScheduledAt!.getTime()).toBeGreaterThan(Date.now());
    expect(status.nextScheduledAt!.getUTCHours()).toBe(7);
    expectScheduleError(dumpFailure);
  });

  it('keeps the interval anchored to a verified backup when falling back from an invalid environment value', async () => {
    const previous = process.env.S3_BACKUP_INTERVAL_DAYS;
    try {
      process.env.S3_BACKUP_INTERVAL_DAYS = 'invalid';
      const verifiedAt = new Date('2026-01-01T00:00:00Z');
      await prisma.backup.create({ data: { status: 'VERIFIED', verifiedAt } });
      expect((await worker().status()).nextScheduledAt).toEqual(
        new Date('2026-01-04T00:00:00Z'),
      );
    } finally {
      process.env.S3_BACKUP_INTERVAL_DAYS = previous;
    }
  });

  it('records a failed attempt if the temporary directory is unavailable', async () => {
    const temp = jest
      .spyOn(fs, 'mkdtemp')
      .mockRejectedValueOnce(new Error('storage full'));
    try {
      await failingWorker().checkSchedule();
      expect(await prisma.backup.findMany()).toMatchObject([
        { status: 'FAILED', failureReason: 'storage full' },
      ]);
      expectScheduleError('Scheduled backup failed: storage full');
    } finally {
      temp.mockRestore();
    }
  });

  it('leaves a pending attempt recoverable when storage and its status write both fail', async () => {
    const statusWrite = jest
      .spyOn(prisma.backup, 'updateMany')
      .mockRejectedValueOnce(new Error('database unavailable'));
    try {
      await failingWorker().checkSchedule();
      expect(await prisma.backup.findMany()).toMatchObject([
        { status: 'PENDING' },
      ]);
      expect(
        (
          await prisma.backupScheduleState.findUniqueOrThrow({
            where: { id: 'singleton' },
          })
        ).leaseUntil,
      ).toBeInstanceOf(Date);
      expectScheduleError('Scheduled backup failed: database unavailable');
    } finally {
      statusWrite.mockRestore();
    }
  });

  it('guards the first legacy interval run and backs off for an hour after failure', async () => {
    await Promise.all([
      failingWorker().checkSchedule(),
      failingWorker().checkSchedule(),
    ]);
    await worker().checkSchedule();
    const [attempt] = await prisma.backup.findMany();
    expect(await prisma.backup.count()).toBe(1);
    expect(attempt.status).toBe('FAILED');
    expectScheduleError(dumpFailure);
    expect((await worker().status()).nextScheduledAt).toEqual(
      new Date(attempt.createdAt.getTime() + 3600000),
    );
  });
});
