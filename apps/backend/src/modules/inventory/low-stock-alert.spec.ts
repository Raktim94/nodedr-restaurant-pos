import { Prisma } from '@prisma/client';
import { StockService } from './stock.service';

// consumeStock rings the low-stock alert only when stock crosses the reorder level,
// and only if the committed stock (re-read after the transaction) is still low.
describe('low-stock alert', () => {
  const D = (v: number) => new Prisma.Decimal(v);
  let committed = 0;
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    ingredient: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          name: 'Paneer',
          unit: 'KG',
          currentStock: D(committed),
          reorderLevel: D(2),
        }),
      ),
    },
  };
  const tx = (start: number) => ({
    ingredient: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: 'i1',
          currentStock: D(start),
          reorderLevel: D(2),
          costPerUnit: D(100),
        }),
      ),
      update: jest.fn(() => Promise.resolve(undefined)),
    },
    stockBatch: {
      findMany: jest.fn(() => Promise.resolve([])),
      update: jest.fn(),
    },
    stockMovement: { create: jest.fn(() => Promise.resolve(undefined)) },
    $queryRaw: jest.fn(() => Promise.resolve([])),
  });
  const svc = () =>
    new StockService(prisma as never, { notifyByPermission: notify } as never);
  const use = (s: StockService, start: number, qty: number) =>
    s.consumeStock(tx(start) as never, 'b1', 'i1', qty, {
      type: 'SALE' as never,
      userId: 'u1',
      allowNegative: true,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    notify.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('rings once when stock drops from above to at/below the reorder level', async () => {
    const s = svc();
    committed = 1.5;
    await use(s, 3, 1.5);
    await jest.advanceTimersByTimeAsync(2_500);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'b1',
      'inventory.manage',
      expect.objectContaining({ type: 'stock.low', entityId: 'i1' }),
    );
    // a later sale while already low does not ring again
    committed = 1;
    await use(s, 1.5, 0.5);
    await jest.advanceTimersByTimeAsync(2_500);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while stock is still above the level', async () => {
    committed = 2.5;
    await use(svc(), 3, 0.5);
    await jest.advanceTimersByTimeAsync(2_500);
    expect(notify).not.toHaveBeenCalled();
  });

  it('stays quiet when the sale rolled back (committed stock is not low)', async () => {
    committed = 3; // the transaction never committed
    await use(svc(), 3, 1.5);
    await jest.advanceTimersByTimeAsync(2_500);
    expect(notify).not.toHaveBeenCalled();
  });
});
