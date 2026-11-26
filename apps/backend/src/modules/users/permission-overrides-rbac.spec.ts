/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await -- hand-built Prisma fakes */
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

function setup(targetName: string, targetKeys: string[]) {
  const prisma: any = {
    user: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'u2',
        role: {
          name: targetName,
          permissions: targetKeys.map((key) => ({ permission: { key } })),
        },
        permissionOverrides: [],
      }),
      findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'u2' }),
    },
    permission: { findMany: jest.fn().mockResolvedValue([]) },
    userPermissionOverride: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(async (ops: any[]) => {
      for (const op of ops) await op;
      return [];
    }),
  };
  const svc: any = Object.create(UsersService.prototype);
  svc.prisma = prisma;
  svc.audit = { record: jest.fn(async () => ({})) };
  return { svc, prisma };
}

const actor = {
  id: 'u1',
  restaurantId: 'r1',
  roleName: 'STAFF',
  permissions: ['users.manage', 'roles.manage', 'orders.create'],
};

const dto = {
  overrides: [
    {
      permissionKey: 'backup.manage',
      effect: 'DENY',
      reason: null,
      expiresAt: null,
    },
  ],
};

describe('permission override privilege ceiling', () => {
  it('refuses to edit overrides of a stronger account', async () => {
    const { svc, prisma } = setup('ADMINISTRATOR', ['backup.manage']);
    await expect(
      svc.setPermissionOverrides('r1', actor, 'u2', dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userPermissionOverride.deleteMany).not.toHaveBeenCalled();
  });

  it('allows editing overrides of an account within the actor reach', async () => {
    const { svc, prisma } = setup('WAITER', ['orders.create']);
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p1', key: 'backup.manage' },
    ]);
    await svc.setPermissionOverrides('r1', actor, 'u2', dto);
    expect(prisma.userPermissionOverride.createMany).toHaveBeenCalled();
  });

  it('lets an actor grant a permission they hold through an implied one', async () => {
    const { svc, prisma } = setup('WAITER', ['orders.create']);
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p1', key: 'menu.view' },
    ]);
    // menu.manage implies menu.view (PERMISSION_IMPLIES)
    const manager = {
      ...actor,
      permissions: ['users.manage', 'orders.create', 'menu.manage'],
    };
    await svc.setPermissionOverrides('r1', manager, 'u2', {
      overrides: [
        {
          permissionKey: 'menu.view',
          effect: 'GRANT',
          reason: null,
          expiresAt: null,
        },
      ],
    });
    expect(prisma.userPermissionOverride.createMany).toHaveBeenCalled();
  });

  it('refuses to grant a permission the actor neither holds nor implies', async () => {
    const { svc, prisma } = setup('WAITER', ['orders.create']);
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p1', key: 'backup.manage' },
    ]);
    await expect(
      svc.setPermissionOverrides('r1', actor, 'u2', {
        overrides: [
          {
            permissionKey: 'backup.manage',
            effect: 'GRANT',
            reason: null,
            expiresAt: null,
          },
        ],
      }),
    ).rejects.toThrow(/cannot grant/);
    expect(prisma.userPermissionOverride.createMany).not.toHaveBeenCalled();
  });

  it('a DENY override on the actor still blocks granting the implied permission', async () => {
    const { svc } = setup('WAITER', ['orders.create']);
    svc.prisma.permission.findMany.mockResolvedValue([
      { id: 'p1', key: 'menu.view' },
    ]);
    const denied = {
      ...actor,
      permissions: [
        'users.manage',
        'orders.create',
        'menu.manage',
        '!menu.view',
      ],
    };
    await expect(
      svc.setPermissionOverrides('r1', denied, 'u2', {
        overrides: [
          {
            permissionKey: 'menu.view',
            effect: 'GRANT',
            reason: null,
            expiresAt: null,
          },
        ],
      }),
    ).rejects.toThrow(/cannot grant/);
  });
});
