/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- hand-built transaction fakes */
import { Prisma } from '@prisma/client';
import { GoodsReceiptsService } from './goods-receipts.service';
import { ProductionService } from './production.service';

describe('inventory integrity', () => {
  it('allocates the next GRN inside a branch lock from the highest number', async () => {
    const svc = new GoodsReceiptsService({} as never);
    const tx: any = {
      $queryRaw: jest.fn(async () => []),
      goodsReceipt: {
        findFirst: jest.fn(async () => ({ grnNumber: 'GRN-0009' })),
      },
    };
    expect(await (svc as any).nextGrnNumber(tx, 'b1')).toBe('GRN-0010');
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('rebuilds weighted-average cost from surviving batches on void', async () => {
    const svc = new ProductionService(
      {} as never,
      {} as never,
      {} as never,
    );
    const update = jest.fn(async () => ({}));
    const tx: any = {
      ingredient: {
        findUniqueOrThrow: jest.fn(async () => ({
          currentStock: new Prisma.Decimal(10),
          costPerUnit: new Prisma.Decimal(4),
        })),
        update,
      },
      stockBatch: {
        findMany: jest.fn(async () => [
          {
            quantityRemaining: new Prisma.Decimal(6),
            unitCost: new Prisma.Decimal(3),
          },
          {
            quantityRemaining: new Prisma.Decimal(4),
            unitCost: new Prisma.Decimal(5),
          },
        ]),
      },
    };
    await (svc as any).restoreOutputCost(tx, 'b1', 'i1');
    const call = update.mock.calls[0] as unknown as any[];
    expect(Number(call[0].data.costPerUnit)).toBe(3.8);
  });

  it('keeps the existing cost when no stock remains', async () => {
    const svc = new ProductionService(
      {} as never,
      {} as never,
      {} as never,
    );
    const update = jest.fn(async () => ({}));
    const tx: any = {
      ingredient: {
        findUniqueOrThrow: jest.fn(async () => ({
          currentStock: new Prisma.Decimal(0),
          costPerUnit: new Prisma.Decimal(4),
        })),
        update,
      },
      stockBatch: { findMany: jest.fn(async () => []) },
    };
    await (svc as any).restoreOutputCost(tx, 'b1', 'i1');
    expect(update).not.toHaveBeenCalled();
  });
});
