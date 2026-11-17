import type { SessionUser } from '@nodedr-restaurant/types';
import { McpToolsBuilder } from './mcp-tools.builder';

describe('shared MCP execution authorization', () => {
  const actor = {
    restaurantId: 'restaurant-1',
    permissions: [],
  } as unknown as SessionUser;
  const access = { assertAccess: jest.fn().mockResolvedValue(undefined) };
  const dashboard = { getSummary: jest.fn().mockResolvedValue({ total: 12 }) };
  const builder = new McpToolsBuilder(
    {} as never,
    access as never,
    {} as never,
    {} as never,
    dashboard as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('refuses execution before calling the service when permission is absent', async () => {
    const result = await builder.execute(actor, 'dashboard_summary', {
      branchId: 'b1',
    });
    expect(result.isError).toBe(true);
    expect(access.assertAccess).not.toHaveBeenCalled();
    expect(dashboard.getSummary).not.toHaveBeenCalled();
  });

  it('checks branch access before executing an authorized tool', async () => {
    const authorized = {
      ...actor,
      permissions: ['dashboard.sales.view'],
    };
    access.assertAccess.mockRejectedValueOnce(new Error('Branch denied'));
    const denied = await builder.execute(authorized, 'dashboard_summary', {
      branchId: 'other',
    });
    expect(denied.isError).toBe(true);
    expect(dashboard.getSummary).not.toHaveBeenCalled();
    const allowed = await builder.execute(authorized, 'dashboard_summary', {
      branchId: 'b1',
    });
    expect(allowed.isError).toBeUndefined();
    expect(access.assertAccess).toHaveBeenCalledWith('restaurant-1', 'b1');
    expect(dashboard.getSummary).toHaveBeenCalledWith('b1');
  });

  it('rejects unknown or partially matching tool names', async () => {
    expect((await builder.execute(actor, 'dashboard')).isError).toBe(true);
  });
});
