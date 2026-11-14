import { TableSessionsService } from './table-sessions.service';

const SECRET = 'a'.repeat(64);
function setup(over: Record<string, unknown> = {}) {
  const session = {
    id: 's1',
    branchId: 'b1',
    tableId: 't1',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 3_600_000),
    joinSecret: SECRET,
    codeHash: 'x',
    lockedUntil: null,
    ...over,
  };
  const prisma = {
    tableSession: {
      findMany: jest
        .fn()
        .mockResolvedValue(session.status === 'ACTIVE' ? [session] : []),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    tableSessionGrant: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    order: { count: jest.fn().mockResolvedValue(0) },
    table: {
      findUnique: jest.fn().mockResolvedValue({ qrToken: 'qr1', number: '4' }),
    },
  };
  const svc = new TableSessionsService(
    prisma as never,
    { record: jest.fn() } as never,
  );
  return { svc, prisma };
}

describe('rotating join QR token', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a current token gives each guest their own grant', async () => {
    const { svc, prisma } = setup();
    const { token } = await svc.currentJoinToken('b1', 't1');
    const a = await svc.joinWithToken('t1', token, 'phoneA');
    const b = await svc.joinWithToken('t1', token, 'phoneB');
    expect(a.token).not.toEqual(b.token);
    expect(prisma.tableSessionGrant.create).toHaveBeenCalledTimes(2);
  });

  it('the token names nothing but a window and a MAC', async () => {
    const { svc } = setup();
    const { token } = await svc.currentJoinToken('b1', 't1');
    expect(token).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
  });

  it('an old photo of the QR stops working after two windows', async () => {
    const { svc } = setup();
    const { token } = await svc.currentJoinToken('b1', 't1');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 100_000);
    await expect(svc.joinWithToken('t1', token, 'p')).rejects.toMatchObject({
      response: { code: 'TABLE_SESSION_BAD_CODE' },
    });
  });

  it('a forged or tampered token is refused', async () => {
    const { svc } = setup();
    const { token } = await svc.currentJoinToken('b1', 't1');
    const [w] = token.split('.');
    await expect(
      svc.joinWithToken('t1', `${w}.AAAAAAAAAAAAAAAAAAAAAA`, 'p'),
    ).rejects.toBeDefined();
    await expect(
      svc.joinWithToken('t1', 'nonsense', 'p'),
    ).rejects.toBeDefined();
  });

  it('a closed table has no token and its old token joins nothing', async () => {
    const live = setup();
    const { token } = await live.svc.currentJoinToken('b1', 't1');
    const closed = setup({ status: 'CLOSED' });
    await expect(
      closed.svc.joinWithToken('t1', token, 'p'),
    ).rejects.toMatchObject({
      response: { code: 'TABLE_SESSION_EXPIRED' },
    });
    await expect(closed.svc.currentJoinToken('b1', 't1')).rejects.toThrow(
      /not open/,
    );
  });

  it('another table session never accepts this one’s token', async () => {
    const a = setup();
    const { token } = await a.svc.currentJoinToken('b1', 't1');
    const other = setup({
      id: 's2',
      tableId: 't2',
      joinSecret: 'b'.repeat(64),
    });
    await expect(
      other.svc.joinWithToken('t2', token, 'p'),
    ).rejects.toBeDefined();
  });

  it('stops handing out grants once a session has too many', async () => {
    const { svc, prisma } = setup();
    prisma.tableSessionGrant.count.mockResolvedValue(60);
    const { token } = await svc.currentJoinToken('b1', 't1');
    await expect(svc.joinWithToken('t1', token, 'p')).rejects.toMatchObject({
      response: { code: 'TABLE_SESSION_LOCKED' },
    });
  });
});
