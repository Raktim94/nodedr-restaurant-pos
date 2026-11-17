import { Prisma } from '@prisma/client';
import { StockService } from './stock.service';

const D = (value: number) => new Prisma.Decimal(value);

function fixture() {
  let stock = D(10);
  let locked = false;
  const ingredient = {
    id: 'ingredient',
    name: 'Rice',
    unit: 'KG',
    costPerUnit: D(5),
    reorderLevel: D(0),
  };
  const tx = {
    // Another committed sale changes 10 to 7 while this caller waits.
    $queryRaw: jest.fn(() => {
      stock = D(7);
      locked = true;
      return Promise.resolve([]);
    }),
    ingredient: {
      findFirst: jest.fn(() =>
        Promise.resolve({ ...ingredient, currentStock: stock }),
      ),
      update: jest.fn(
        ({ data }: { data: { currentStock: Prisma.Decimal.Value } }) => {
          stock = D(Number(data.currentStock));
          return Promise.resolve(undefined);
        },
      ),
    },
    stockBatch: {
      findMany: jest.fn(() => Promise.resolve([])),
      update: jest.fn(),
    },
    stockMovement: { create: jest.fn(() => Promise.resolve({})) },
  };
  const prisma = {
    $transaction: (work: (t: typeof tx) => unknown) =>
      Promise.resolve(work(tx)),
  };
  return {
    tx,
    service: new StockService(prisma as never),
    balance: () => stock.toNumber(),
    locked: () => locked,
  };
}

describe('stock mutations after waiting for an ingredient lock', () => {
  it('deducts from the latest committed balance instead of overwriting a concurrent sale', async () => {
    const f = fixture();
    await f.service.consumeStock(f.tx as never, 'branch', 'ingredient', 2, {
      type: 'CONSUMPTION',
      userId: 'user',
    });
    expect(f.balance()).toBe(5);
  });

  it('rejects over-consumption against the latest balance', async () => {
    const f = fixture();
    await expect(
      f.service.consumeStock(f.tx as never, 'branch', 'ingredient', 8, {
        type: 'WASTE',
        userId: 'user',
      }),
    ).rejects.toThrow('only 7 in stock');
    expect(f.tx.ingredient.update).not.toHaveBeenCalled();
  });

  it('applies a manual adjustment to the latest balance', async () => {
    const f = fixture();
    await f.service.adjustStock('branch', 'user', 'ingredient', {
      quantity: 2,
      note: 'Stocktake correction',
    });
    expect(f.locked()).toBe(true);
    expect(f.balance()).toBe(9);
  });
});
