/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- hand-built Prisma fakes */
import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';

const svc = () => Object.create(OrdersService.prototype);

describe('order edit guard', () => {
  it('takes the OPEN/no-payment row lock before an edit', async () => {
    const tx: any = {
      order: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    await svc().assertOrderEditableInTx(tx, 'o1');
    const where = tx.order.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: 'o1',
      status: 'OPEN',
      payments: { none: {} },
    });
  });

  it('refuses to edit when a payment or status change won the race', async () => {
    const tx: any = {
      order: { updateMany: jest.fn(async () => ({ count: 0 })) },
    };
    await expect(
      svc().assertOrderEditableInTx(tx, 'o1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
