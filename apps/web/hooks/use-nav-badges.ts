"use client";

import { useBranch } from "@/hooks/use-branch";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useLowStockIngredients } from "@/hooks/use-inventory";
import { useNotifications } from "@/hooks/use-notifications";
import { useBackups } from "@/hooks/use-backups";
import { useUpdateCheck } from "@/hooks/use-updates";

// Which sidebar sections and Settings tabs have something that needs the
// user's attention. Everything here reuses queries the app already runs
// (notifications poll every 10s), plus a few cheap permission-gated checks.
export interface NavBadges {
  /** Sidebar item href -> true when it needs attention. */
  nav: Record<string, boolean>;
  /** Settings tab href -> true when it needs attention. */
  settingsTabs: Record<string, boolean>;
}

// Unread notification entity -> the sidebar section that owns it.
const ENTITY_TO_NAV: Record<string, string> = {
  Order: "/orders",
  Reservation: "/reservations",
  Table: "/tables",
};

export function useNavBadges(): NavBadges {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const user = me?.user;

  const canUpdate = hasPermission(user, "system.update");
  const canBackup = hasPermission(user, "backup.manage");
  const canInventory = hasPermission(user, "inventory.manage");

  const { data: notifications } = useNotifications();
  const { data: update } = useUpdateCheck(canUpdate);
  const { data: backups } = useBackups(canBackup);
  const { data: lowStock } = useLowStockIngredients(canInventory ? branchId : null);

  const nav: Record<string, boolean> = {};
  const settingsTabs: Record<string, boolean> = {};

  for (const n of notifications?.data ?? []) {
    if (n.readAt) continue;
    const href = n.entity ? ENTITY_TO_NAV[n.entity] : undefined;
    if (href) nav[href] = true;
    if (n.entity === "Backup" || n.entity === "BackupConfig") {
      nav["/settings"] = true;
      settingsTabs["/settings/backup"] = true;
    }
  }

  if (canInventory && (lowStock?.length ?? 0) > 0) nav["/inventory"] = true;

  if (canUpdate && update?.updateAvailable) {
    nav["/settings"] = true;
    settingsTabs["/settings/updates"] = true;
  }

  // The newest backup failing is worth a nudge even if the notification was read.
  if (canBackup && backups?.[0]?.status === "FAILED") {
    nav["/settings"] = true;
    settingsTabs["/settings/backup"] = true;
  }

  return { nav, settingsTabs };
}
