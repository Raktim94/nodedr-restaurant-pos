import { ForbiddenException } from '@nestjs/common';
import type { SessionUser } from '@nodedr-restaurant/types';
import { AiService } from './ai.service';

const user = { restaurantId: 'r1', permissions: [] } as unknown as SessionUser;

function make(
  assertAccess = jest.fn(),
  findFirst = jest.fn().mockResolvedValue({ id: 'b-own' }),
) {
  const prisma = { branch: { findFirst } };
  const mcp = { toolDefs: jest.fn().mockReturnValue([]) };
  const svc = new AiService(
    { get: jest.fn() } as never,
    prisma as never,
    mcp as never,
    {
      assertAccess,
    } as never,
  );
  return { svc, assertAccess, findFirst };
}

describe('AiService.executeAction tenancy', () => {
  it('refuses a branch that is not in the caller restaurant', async () => {
    const { svc } = make(jest.fn().mockRejectedValue(new ForbiddenException()));
    await expect(
      svc.executeAction({
        user,
        branchId: 'other-tenant-branch',
        actionPayload: {},
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks access for an explicit branch', async () => {
    const { svc, assertAccess } = make();
    await svc.executeAction({ user, branchId: 'b1', actionPayload: {} });
    expect(assertAccess).toHaveBeenCalledWith('r1', 'b1');
  });

  it('without a branch, only falls back to the caller restaurant', async () => {
    const { svc, findFirst } = make();
    await svc.executeAction({ user, actionPayload: {} });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { restaurantId: 'r1' } }),
    );
  });

  it('rejects an oversized action list', async () => {
    const { svc } = make();
    const actions = Array.from({ length: 21 }, () => ({ toolName: 'x' }));
    await expect(
      svc.executeAction({
        user,
        branchId: 'b1',
        actionPayload: { actions } as never,
      }),
    ).rejects.toThrow(/At most/);
  });
});
