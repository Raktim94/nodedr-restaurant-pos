"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

interface SettingsTab {
  label: string;
  href: string;
  /** Omit to show the tab to anyone who can reach /settings at all. */
  permission?: string;
}

const TABS: SettingsTab[] = [
  { label: "General", href: "/settings" },
  { label: "Staff", href: "/settings/staff", permission: "users.manage" },
  { label: "Roles", href: "/settings/roles", permission: "roles.manage" },
  { label: "Audit Log", href: "/settings/audit-log", permission: "audit_log.view" },
  { label: "Backup", href: "/settings/backup", permission: "backup.manage" },
  { label: "Updates", href: "/settings/updates", permission: "system.update" },
  { label: "API Keys", href: "/settings/api-keys" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const { data } = useCurrentUser();
  const user = data?.user;

  const visibleTabs = TABS.filter(
    (tab) => !tab.permission || hasPermission(user, tab.permission),
  );

  return (
    <nav className="flex gap-1 border-b border-border">
      {visibleTabs.map((tab) => {
        const isActive =
          tab.href === "/settings" ? pathname === "/settings" : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
