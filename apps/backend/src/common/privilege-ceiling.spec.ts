import type { SessionUser } from '@nodedr-restaurant/types';
import { assertMayGrantKeys, assertMayManageRole, mayManageRole } from './privilege-ceiling';

const user = (roleName: string, permissions: string[]): SessionUser =>
  ({ id: 'u', restaurantId: 'r', name: 'n', roleId: 'x', roleName, permissions }) as SessionUser;
const role = (name: string, keys: string[]) => ({ name, permissions: keys.map((k) => ({ permission: { key: k } })) });

describe('privilege ceiling', () => {
  const owner = user('OWNER', ['users.manage', 'roles.manage', 'backup.manage', 'settings.manage']);
  const admin = user('ADMINISTRATOR', ['users.manage', 'roles.manage', 'backup.manage', 'settings.manage']);
  const staffAdmin = user('CUSTOM', ['users.manage']);

  it('lets an owner manage any role', () => {
    expect(mayManageRole(owner, role('OWNER', ['backup.manage']))).toBe(true);
    expect(mayManageRole(owner, role('WAITER', []))).toBe(true);
  });
  it('reserves OWNER for owners even when the actor holds every permission', () => {
    expect(mayManageRole(admin, role('OWNER', ['users.manage']))).toBe(false);
    expect(() => assertMayManageRole(admin, role('OWNER', []))).toThrow(/more access/);
  });
  it('refuses a role that holds a permission the actor lacks', () => {
    expect(mayManageRole(staffAdmin, role('MANAGER', ['users.manage', 'backup.manage']))).toBe(false);
    expect(mayManageRole(staffAdmin, role('WAITER', ['users.manage']))).toBe(true);
  });
  it('only grants keys the actor holds', () => {
    expect(() => assertMayGrantKeys(staffAdmin, ['users.manage'])).not.toThrow();
    expect(() => assertMayGrantKeys(staffAdmin, ['users.manage', 'settings.manage'])).toThrow(/hold yourself/);
  });
  it('treats an implied permission as held', () => {
    const inv = user('INV', ['inventory.manage']);
    expect(mayManageRole(inv, role('X', ['production.post']))).toBe(true);
  });
});
