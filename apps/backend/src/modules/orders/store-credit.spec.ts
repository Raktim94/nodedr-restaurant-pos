/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- hand-built Prisma fakes */
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

const svc = () => Object.create(OrdersService.prototype);

describe('store-credit tender', () => {
  function fakeTx(balance: number | null, updateCount = 1) {
    const tx: any = {
      customer: {
        findFirst: jest.fn(async () =>
          balance === null ? null : { walletBalance: balance },
        ),
        updateMany: jest.fn(async () => ({ count: updateCount })),
      },
    };
    return { tx };
  }

  it('debits the wallet atomically with a guarded balance check', async () => {
    const { tx } = fakeTx(50);
    await svc().debitStoreCredit(tx, {
      branchId: 'b1',
      customerId: 'c1',
      amount: 30,
    });
    expect(tx.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', branchId: 'b1' },
      select: { walletBalance: true },
    });
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'c1',
        branchId: 'b1',
        walletBalance: { gte: 30 },
      },
      data: { walletBalance: { decrement: 30 } },
    });
  });

  it('refuses insufficient credit and a lost race without debiting', async () => {
    const poor = fakeTx(10);
    await expect(
      svc().debitStoreCredit(poor.tx, {
        branchId: 'b1',
        customerId: 'c1',
        amount: 30,
      }),
    ).rejects.toThrow(/only has 10/);
    expect(poor.tx.customer.updateMany).not.toHaveBeenCalled();

    const raced = fakeTx(50, 0);
    await expect(
      svc().debitStoreCredit(raced.tx, {
        branchId: 'b1',
        customerId: 'c1',
        amount: 30,
      }),
    ).rejects.toThrow(/changed/);
  });

  it('refuses store credit without a branch-owned customer', async () => {
    const none = fakeTx(50);
    await expect(
      svc().debitStoreCredit(none.tx, {
        branchId: 'b1',
        customerId: null,
        amount: 30,
      }),
    ).rejects.toThrow(/requires a customer/);
    const foreign = fakeTx(null);
    await expect(
      svc().debitStoreCredit(foreign.tx, {
        branchId: 'b1',
        customerId: 'foreign',
        amount: 30,
      }),
    ).rejects.toThrow(/not found for this branch/);
  });

  it('refuses a store-credit refund on a bill with no customer', async () => {
    const service = svc();
    service.prisma = {
      order: {
        findFirst: jest.fn(async () => ({
          id: 'o1',
          status: 'PAID',
          customerId: null,
        })),
      },
      $transaction: jest.fn(),
    };
    await expect(
      service.refund('b1', 'o1', 'u1', {
        amount: 10,
        method: 'STORE_CREDIT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.prisma.$transaction).not.toHaveBeenCalled();
  });
});
