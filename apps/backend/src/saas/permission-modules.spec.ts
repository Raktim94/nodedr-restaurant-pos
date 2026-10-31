import { ModuleKey } from '@prisma/client';
import { moduleForPermission } from './permission-modules';

describe('moduleForPermission', () => {
  it.each([
    ['orders.create', ModuleKey.POS],
    ['bills.print', ModuleKey.POS],
    ['inventory.manage', ModuleKey.INVENTORY],
    ['accounting.manage', ModuleKey.ACCOUNTING],
    ['staff.manage', ModuleKey.HR],
    ['kds.manage', ModuleKey.KDS],
  ])('maps %s to its licensed module', (permission, moduleKey) => {
    expect(moduleForPermission(permission)).toBe(moduleKey);
  });

  it('does not invent a module for platform-neutral permissions', () => {
    expect(moduleForPermission('users.manage')).toBeNull();
  });
});
