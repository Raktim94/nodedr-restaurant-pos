/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- hand-built Prisma fakes */
import { OrdersService } from './orders.service';

const svc = (): any => {
  const s = Object.create(OrdersService.prototype);
  s.realtime = { emitToBranch: jest.fn() };
  return s;
};

function txFor(ticketMode: string | undefined) {
  return {
    branch: {
      findUnique: jest.fn(async () => ({ ticketMode })),
    },
    menuItem: {
      findMany: jest.fn(async () => [{ id: 'm1', stationId: 's1' }]),
    },
    kot: {
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'k1', ...data })),
    },
  };
}

const items = [{ id: 'i1', menuItemId: 'm1' }];

describe('ticket mode (bill-only branches)', () => {
  it('creates station tickets in KDS mode (historic behaviour)', async () => {
    const tx = txFor('KDS');
    await svc().generateKots(tx, 'o1', 'b1', items);
    expect(tx.branch.findUnique).toHaveBeenCalledWith({
      where: { id: 'b1' },
      select: { ticketMode: true },
    });
    expect(tx.kot.create).toHaveBeenCalledTimes(1);
  });

  it('creates no kitchen ticket at all in BILL_ONLY mode', async () => {
    const tx = txFor('BILL_ONLY');
    await svc().generateKots(tx, 'o1', 'b1', items);
    expect(tx.kot.create).not.toHaveBeenCalled();
    // No lookups past the gate either — the branch opt-out is checked first.
    expect(tx.menuItem.findMany).not.toHaveBeenCalled();
  });

  it('defaults to KDS when the branch row has no ticketMode', async () => {
    const tx = txFor(undefined);
    await svc().generateKots(tx, 'o1', 'b1', items);
    expect(tx.kot.create).toHaveBeenCalledTimes(1);
  });
});
