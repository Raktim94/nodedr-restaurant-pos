import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  permissionSatisfied,
  STAFF_ROLES,
} from '@nodedr-restaurant/types';

describe('Stock Journal manager role', () => {
  const held = DEFAULT_ROLE_PERMISSIONS.STOCK_JOURNAL_MANAGER;

  it('is a system role with default permissions', () => {
    expect(STAFF_ROLES).toContain('STOCK_JOURNAL_MANAGER');
    expect(PERMISSIONS.some((p) => p.key === 'journal.manage')).toBe(true);
  });

  it('can run every kind of journal entry and the production workflow', () => {
    for (const need of [
      'journal.manage',
      'production.record',
      'production.post',
      'production.void',
      'production.report',
      'production.quality',
    ]) {
      expect(permissionSatisfied(held, need)).toBe(true);
    }
  });

  it('cannot manage the rest of inventory, the menu, sales or staff', () => {
    for (const need of [
      'inventory.manage',
      'menu.manage',
      'menu.price',
      'sales.view',
      'dashboard.sales.view',
      'staff.manage',
      'accounting.manage',
    ]) {
      expect(permissionSatisfied(held, need)).toBe(false);
    }
  });

  it('is still implied for whoever holds inventory.manage', () => {
    expect(permissionSatisfied(['inventory.manage'], 'journal.manage')).toBe(
      true,
    );
    expect(
      permissionSatisfied(
        DEFAULT_ROLE_PERMISSIONS.INVENTORY_MANAGER,
        'journal.manage',
      ),
    ).toBe(true);
    expect(
      permissionSatisfied(
        DEFAULT_ROLE_PERMISSIONS.RESTAURANT_MANAGER,
        'journal.manage',
      ),
    ).toBe(true);
  });

  it('is not granted to kitchen staff or chefs', () => {
    for (const r of ['KITCHEN_STAFF', 'CHEF', 'WAITER', 'CASHIER'] as const) {
      expect(
        permissionSatisfied(DEFAULT_ROLE_PERMISSIONS[r], 'journal.manage'),
      ).toBe(false);
    }
  });
});
