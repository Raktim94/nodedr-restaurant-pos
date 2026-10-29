export interface PermissionSource {
  role: { permissions: { permission: { key: string } }[] };
  permissionOverrides?: {
    allowed: boolean;
    validFrom: Date;
    validUntil: Date | null;
    permission: { key: string };
  }[];
}

export const permissionInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  permissionOverrides: { include: { permission: true } },
} as const;

export function effectivePermissions(
  user: PermissionSource,
  now = new Date(),
): string[] {
  const permissions = new Set(
    user.role.permissions.map((entry) => entry.permission.key),
  );
  for (const override of user.permissionOverrides ?? []) {
    if (override.validFrom > now) continue;
    if (override.validUntil && override.validUntil <= now) continue;
    if (override.allowed) permissions.add(override.permission.key);
    else permissions.delete(override.permission.key);
  }
  return [...permissions];
}
