"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  Building2, 
  Users, 
  ShieldCheck, 
  History, 
  Database, 
  Sparkles, 
  RefreshCw, 
  Smartphone, 
  Tv, 
  Bell, 
  Gamepad2, 
  Layers, 
  CreditCard, 
  KeyRound, 
  Lock, 
  Webhook, 
  FileCheck2,
  ChevronDown
} from "lucide-react";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { useBranch } from "@/hooks/use-branch";
import { useSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";
import { NavDot } from "@/components/layout/nav-dot";

interface SettingsTab {
  label: string;
  href: string;
  icon: React.ElementType;
  group: "Restaurant" | "System & Operations" | "Integrations & Dev";
  permission?: string;
  country?: string;
}

const TABS: SettingsTab[] = [
  // Restaurant & People
  { label: "General", href: "/settings", icon: Building2, group: "Restaurant" },
  { label: "Staff", href: "/settings/staff", icon: Users, group: "Restaurant", permission: "users.manage" },
  { label: "Roles", href: "/settings/roles", icon: ShieldCheck, group: "Restaurant", permission: "roles.manage" },
  { label: "Security", href: "/settings/security", icon: Lock, group: "Restaurant" },
  { label: "Audit Log", href: "/settings/audit-log", icon: History, group: "Restaurant", permission: "audit_log.view" },

  // System & Hardware
  { label: "Updates", href: "/settings/updates", icon: Sparkles, group: "System & Operations", permission: "system.update" },
  { label: "Backup", href: "/settings/backup", icon: Database, group: "System & Operations", permission: "backup.manage" },
  { label: "Server Sync", href: "/settings/sync", icon: RefreshCw, group: "System & Operations", permission: "settings.manage" },
  { label: "Phones", href: "/settings/devices", icon: Smartphone, group: "System & Operations", permission: "users.manage" },
  { label: "Customer screen", href: "/settings/customer-screen", icon: Tv, group: "System & Operations", permission: "settings.manage" },
  { label: "Buzzers", href: "/settings/buzzers", icon: Bell, group: "System & Operations", permission: "settings.manage" },
  { label: "Simulator", href: "/simulator", icon: Gamepad2, group: "System & Operations", permission: "settings.manage" },

  // Integrations & Developer
  { label: "Payments", href: "/settings/payment-gateways", icon: CreditCard, group: "Integrations & Dev", permission: "settings.manage" },
  { label: "Integrations", href: "/settings/integrations", icon: Layers, group: "Integrations & Dev", permission: "settings.manage" },
  { label: "API Keys", href: "/settings/api-keys", icon: KeyRound, group: "Integrations & Dev" },
  { label: "Webhooks", href: "/settings/webhooks", icon: Webhook, group: "Integrations & Dev", permission: "settings.manage" },
  { label: "VERI*FACTU", href: "/settings/verifactu", icon: FileCheck2, group: "Integrations & Dev", permission: "settings.manage", country: "ES" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useCurrentUser();
  const user = data?.user;
  const badges = useNavBadges();
  const { branchId } = useBranch();
  const branchCountry = useSettings(branchId).data?.branch.country;

  const visibleTabs = TABS.filter(
    (tab) =>
      (!tab.permission || hasPermission(user, tab.permission)) &&
      (!tab.country || branchCountry === tab.country),
  );

  const activeTab = visibleTabs.find((tab) =>
    tab.href === "/settings" ? pathname === "/settings" : pathname?.startsWith(tab.href)
  ) ?? visibleTabs[0];

  return (
    <div className="flex flex-col gap-2.5 pb-2">
      {/* Mobile Settings Picker: Native Touch-Friendly Sheet Menu */}
      <div className="md:hidden flex flex-col gap-1.5 w-full">
        <label htmlFor="mobile-settings-nav" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-0.5">
          Settings Section
        </label>
        <div className="relative">
          <select
            id="mobile-settings-nav"
            value={activeTab?.href ?? "/settings"}
            onChange={(e) => router.push(e.target.value)}
            className="h-11 w-full appearance-none rounded-xl border border-input bg-card px-3.5 pr-10 text-xs font-semibold text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 shadow-2xs"
          >
            {["Restaurant", "System & Operations", "Integrations & Dev"].map((groupName) => {
              const groupTabs = visibleTabs.filter((t) => t.group === groupName);
              if (groupTabs.length === 0) return null;
              return (
                <optgroup key={groupName} label={groupName}>
                  {groupTabs.map((tab) => (
                    <option key={tab.href} value={tab.href}>
                      {tab.label} {badges.settingsTabs[tab.href] ? "• (Update)" : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* Desktop / Tablet: Apple Segmented Pill Navigation */}
      <nav
        aria-label="Settings navigation"
        className="hidden md:flex items-center gap-1.5 p-1 bg-muted/60 dark:bg-muted/40 rounded-2xl w-full overflow-x-auto scrollbar-none border border-border/50"
      >
        {visibleTabs.map((tab) => {
          const isActive =
            tab.href === "/settings" ? pathname === "/settings" : pathname?.startsWith(tab.href);
          const TabIcon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-all shrink-0 active:scale-97 select-none relative",
                isActive
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <TabIcon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
              <span>{tab.label}</span>
              {badges.settingsTabs[tab.href] ? <NavDot className="ml-0" /> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
