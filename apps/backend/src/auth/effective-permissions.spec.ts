import { effectivePermissions } from './effective-permissions';

describe('effectivePermissions', () => {
  const base = {
    role: {
      permissions: [
        { permission: { key: 'orders.create' } },
        { permission: { key: 'accounting.manage' } },
      ],
    },
  };

  it('applies active allow and deny overrides', () => {
    expect(
      effectivePermissions(
        {
          ...base,
          permissionOverrides: [
            {
              allowed: false,
              validFrom: new Date('2026-01-01'),
              validUntil: null,
              permission: { key: 'accounting.manage' },
            },
            {
              allowed: true,
              validFrom: new Date('2026-01-01'),
              validUntil: null,
              permission: { key: 'inventory.manage' },
            },
          ],
        },
        new Date('2026-10-30'),
      ),
    ).toEqual(expect.arrayContaining(['orders.create', 'inventory.manage']));
  });

  it('ignores expired overrides', () => {
    expect(
      effectivePermissions(
        {
          ...base,
          permissionOverrides: [
            {
              allowed: false,
              validFrom: new Date('2026-01-01'),
              validUntil: new Date('2026-02-01'),
              permission: { key: 'orders.create' },
            },
          ],
        },
        new Date('2026-10-30'),
      ),
    ).toContain('orders.create');
  });
});
