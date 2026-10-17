"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { SessionUser } from "@nodedr-restaurant/types";
import { hasPermission } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useNavBadges } from "@/hooks/use-nav-badges";
import { NAV_ITEMS } from "./nav-items";

// The screens staff jump between all shift long, in priority order. Whatever
// the signed-in role can't open is skipped, so a kitchen-only login still gets
// a full bar. Everything else lives behind "More" (the existing drawer).
const PRIMARY_HREFS = ["/pos", "/orders", "/tables", "/kds", "/dashboard"];
const PRIMARY_COUNT = 4;

// Thumb-reach navigation for phones. Hidden from lg up, where the sidebar takes over.
export function MobileBottomNav({
  user,
  onMore,
}: {
  user?: SessionUser;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const badges = useNavBadges();

  const allowed = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(user, item.permission),
  );
  const primary = PRIMARY_HREFS.map((href) => allowed.find((i) => i.href === href))
    .filter((i): i is (typeof allowed)[number] => !!i)
    .slice(0, PRIMARY_COUNT);

  const itemClass =
    "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {primary.map((item) => {
        const isActive = pathname?.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              itemClass,
              "h-16",
              isActive ? "text-primary" : "text-muted-foreground active:text-foreground",
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
            <span className="max-w-full truncate px-1">{t(item.labelKey)}</span>
            {badges.nav[item.href] && !isActive ? (
              <span className="absolute top-2 left-1/2 ml-2 h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_2px_rgba(245,158,11,0.7)]" />
            ) : null}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className={cn(itemClass, "h-16 text-muted-foreground active:text-foreground")}
      >
        <MoreHorizontal className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
