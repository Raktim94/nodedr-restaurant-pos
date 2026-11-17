import { TransfersService } from './transfers.service';

describe('stock transfer locking', () => {
  it('locks both branches in stable order before consuming or creating stock', async () => {
    const events: string[] = [];
    const source = {
      id: 'source',
      name: 'Rice',
      unit: 'KG',
      sku: null,
      reorderLevel: 0,
    };
    const tx = {
      $queryRaw: jest.fn((_strings: TemplateStringsArray, id: string) => {
        events.push(`lock:${id}`);
        return Promise.resolve([]);
      }),
      ingredient: {
        findFirst: jest.fn(() => {
          events.push('find-destination');
          return Promise.resolve(null);
        }),
        create: jest.fn(() => {
          events.push('create-destination');
          return Promise.resolve({ id: 'dest', unit: 'KG' });
        }),
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({ currentStock: 0, costPerUnit: 0 }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
      stockBatch: { create: jest.fn(() => Promise.resolve({ id: 'batch' })) },
      stockMovement: { create: jest.fn(() => Promise.resolve({})) },
      stockTransfer: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      branch: {
        findFirst: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, name: where.id }),
        ),
      },
      ingredient: { findFirst: jest.fn(() => Promise.resolve(source)) },
      $transaction: (fn: (value: typeof tx) => unknown) => fn(tx),
    };
    const stock = {
      consumeStock: jest.fn(() => {
        events.push('consume');
        return Promise.resolve([{ quantity: 2, unitCost: 5 }]);
      }),
    };
    await new TransfersService(prisma as never, stock as never).transfer(
      'restaurant',
      'user',
      'z',
      {
        toBranchId: 'a',
        ingredientId: 'source',
        quantity: 2,
      },
    );
    expect(events).toEqual([
      'lock:a',
      'lock:z',
      'consume',
      'find-destination',
      'create-destination',
      'lock:dest',
    ]);
  });
});
