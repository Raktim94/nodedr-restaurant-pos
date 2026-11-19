import { demoRestricted } from './demo.module';

describe('demo restrictions', () => {
  it('blocks API-key and MCP issuance for demo visitors', () => {
    expect(demoRestricted('/v1/staff-api-keys', 'POST')).toBe(true);
    expect(demoRestricted('/v1/integration-api-keys', 'POST')).toBe(true);
    expect(demoRestricted('/v1/mcp', 'POST')).toBe(true);
  });

  it('still allows ordinary reads and checkout', () => {
    expect(demoRestricted('/v1/menu', 'GET')).toBe(false);
    expect(demoRestricted('/v1/orders', 'POST')).toBe(false);
    expect(demoRestricted('/v1/mcp', 'GET')).toBe(false);
  });
});
