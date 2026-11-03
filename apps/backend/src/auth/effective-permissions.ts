// A user's real permission set = role permissions + live GRANT overrides
// - live DENY overrides. DENY wins over both the role and a GRANT, and an
// expired override is ignored (so temporary access revokes itself without a
// cron job). Pure function: every login/JWT/API-key path funnels through it.

export interface PermissionSource {
  role: { permissions: { permission: { key: string } }[] };
  permissionOverrides?: {
    effect: 'GRANT' | 'DENY';
    expiresAt: Date | null;
    permission: { key: string };
  }[];
}

export const permissionInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  permissionOverrides: { include: { permission: true } },
} as const;

export function effectivePermissions(
  user: PermissionSource,
  now: Date = new Date(),
): string[] {
  const keys = new Set(user.role.permissions.map((rp) => rp.permission.key));
  const live = (user.permissionOverrides ?? []).filter(
    (o) => !o.expiresAt || o.expiresAt.getTime() > now.getTime(),
  );
  for (const o of live) if (o.effect === 'GRANT') keys.add(o.permission.key);
  for (const o of live) if (o.effect === 'DENY') keys.delete(o.permission.key);
  return [...keys];
}
