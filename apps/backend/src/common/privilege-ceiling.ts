import { ForbiddenException } from '@nestjs/common';
import { permissionSatisfied, type SessionUser } from '@nodedr-restaurant/types';

/**
 * Nobody can hand out, edit or take over more access than they hold themselves. Without this, a custom role that
 * only has "manage staff" or "manage roles" could promote itself to OWNER, reset the owner's password and 2FA,
 * or add every permission to its own role. `OWNER` is also reserved: only an owner may assign, edit or manage it
 * (an ADMINISTRATOR holds every permission, so the permission check alone would not stop that).
 */
export interface RoleForCeiling {
  name: string;
  permissions: { permission: { key: string } }[];
}

const DENIED = 'You cannot do that to a role or account with more access than your own.';

export function mayManageRole(actor: SessionUser, role: RoleForCeiling): boolean {
  if (role.name === 'OWNER' && actor.roleName !== 'OWNER') return false;
  return role.permissions.every((p) => permissionSatisfied(actor.permissions, p.permission.key));
}

/** A staff account: its role plus any permission granted to it directly (a still-live GRANT override). */
export interface UserForCeiling extends RoleForCeiling {
  // role fields are flattened by the caller; see userCeilingSubject
}

export function userCeilingSubject(user: {
  role: RoleForCeiling & { name: string };
  permissionOverrides?: { effect: string; expiresAt: Date | null; permission: { key: string } }[];
}): RoleForCeiling {
  const now = Date.now();
  const grants = (user.permissionOverrides ?? [])
    .filter((o) => o.effect === 'GRANT' && (!o.expiresAt || o.expiresAt.getTime() > now))
    .map((o) => ({ permission: { key: o.permission.key } }));
  return { name: user.role.name, permissions: [...user.role.permissions, ...grants] };
}

export function assertMayManageRole(actor: SessionUser, role: RoleForCeiling): void {
  if (!mayManageRole(actor, role)) throw new ForbiddenException(DENIED);
}

export function assertMayGrantKeys(actor: SessionUser, keys: readonly string[]): void {
  if (!keys.every((k) => permissionSatisfied(actor.permissions, k))) {
    throw new ForbiddenException('You can only give a role permissions that you hold yourself.');
  }
}
