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

describe('AiService.executeAction tool matching', () => {
  it('renders the dashboard currency in revenue summaries', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ todayRevenue: 25, currency: 'BRL' }),
        },
      ],
    });
    const service = new AiService(
      {} as never,
      {} as never,
      {
        toolDefs: () => [{ name: 'dashboard_summary', handler }],
      } as never,
      { assertAccess: jest.fn() } as never,
    );
    const result = await service.executeAction({
      user,
      branchId: 'b1',
      actionPayload: { command: 'dashboard_summary' },
    });
    expect(result.message).toContain('R$25.00');
  });

  it('matches tool names with dashes or spaces, and never guesses staff credentials from other text', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    const tool = {
      name: 'create_staff_member',
      requiredPermission: undefined,
      run,
      handler: run,
    };
    const prisma = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1' }) },
    };
    const mcp = { toolDefs: jest.fn().mockReturnValue([tool]) };
    const svc = new AiService(
      { get: jest.fn() } as never,
      prisma as never,
      mcp as never,
      {
        assertAccess: jest.fn(),
      } as never,
    );
    const res = await svc.executeAction({
      user,
      branchId: 'b1',
      actionPayload: {
        command: 'create-staff member',
        title: 'note',
        items: [{ name: 'password: hunter2 pin 1234 a@b.co' }],
      },
    });
    expect((res as { message?: string }).message ?? '').not.toMatch(
      /No MCP tool found/,
    );
    expect(run).toHaveBeenCalled();
    const passed = JSON.stringify(run.mock.calls);
    expect(passed).not.toContain('hunter2');
    expect(passed).not.toContain('a@b.co');
  });
});
