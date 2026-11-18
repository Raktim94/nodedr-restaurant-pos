"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Stock items", href: "/inventory" },
  { label: "Areas", href: "/inventory/areas" },
  { label: "Stock take", href: "/inventory/stock-take" },
  { label: "Shopping list", href: "/inventory/shopping-list" },
  { label: "Stock journal", href: "/inventory/journal" },
  { label: "Stock report", href: "/inventory/stock-report" },
  { label: "Recipes", href: "/inventory/recipes" },
  { label: "Yield analysis", href: "/inventory/yield-analysis" },
  { label: "Suppliers", href: "/inventory/suppliers" },
  { label: "Purchase Orders", href: "/inventory/purchase-orders" },
  { label: "Procurement", href: "/inventory/procurement" },
  { label: "Transfers", href: "/inventory/transfers" },
  { label: "Waste", href: "/inventory/waste" },
];

// Tabs a Stock Journal manager (no general inventory permission) can actually use; the rest would only show errors.
const JOURNAL_TABS = new Set(["/inventory/journal", "/inventory/waste"]);

export function InventoryTabs() {
  const pathname = usePathname();
  const { data: me } = useCurrentUser();
  const tabs = hasPermission(me?.user, "inventory.manage") ? TABS : TABS.filter((t) => JOURNAL_TABS.has(t.href));

  return (
    <nav aria-label="Inventory sections" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/inventory" ? pathname === "/inventory" : pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
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
