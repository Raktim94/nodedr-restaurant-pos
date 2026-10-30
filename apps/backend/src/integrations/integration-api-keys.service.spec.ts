/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- prisma fake */
import { NotFoundException } from '@nestjs/common';
import { IntegrationApiKeysService } from './integration-api-keys.service';

const actor = { id: 'u1', restaurantId: 'r1' } as never;
const oldKey = {
  id: 'k1',
  restaurantId: 'r1',
  branchId: 'b1',
  name: 'Website',
  scopes: ['orders:read', 'orders:read_customer'],
  expiresAt: null,
  revokedAt: null,
};

function build(found: unknown) {
  const tx = {
    integrationApiKey: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'k2',
        createdAt: new Date(),
        ...data,
      })),
      update: jest.fn(async () => ({})),
    },
    order: { updateMany: jest.fn(async () => ({ count: 3 })) },
  };
  const prisma: any = {
    integrationApiKey: { findFirst: jest.fn(async () => found) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return {
    svc: new IntegrationApiKeysService(prisma, {} as never),
    tx,
    prisma,
  };
}

describe('IntegrationApiKeysService.rotate', () => {
  it('issues a new secret with the same scopes, moves orders, revokes the old key', async () => {
    const { svc, tx } = build(oldKey);
    const res = await svc.rotate(actor, 'k1');
    expect(res.token).toMatch(/^ordr_ext_/);
    expect(res.scopes).toEqual(oldKey.scopes);
    expect(res.branchId).toBe('b1');
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { integrationKeyId: 'k1' },
      data: { integrationKeyId: 'k2' },
    });
    expect(tx.integrationApiKey.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('404s for an unknown, revoked or other-restaurant key', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.rotate(actor, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.integrationApiKey.findFirst).toHaveBeenCalledWith({
      where: { id: 'nope', restaurantId: 'r1', revokedAt: null },
    });
  });
});
