"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Stock items", href: "/inventory" },
  { label: "Areas", href: "/inventory/areas" },
  { label: "Stock take", href: "/inventory/stock-take" },
  { label: "Shopping list", href: "/inventory/shopping-list" },
  { label: "Stock journal", href: "/inventory/journal" },
  { label: "Production", href: "/inventory/production" },
  { label: "Suppliers", href: "/inventory/suppliers" },
  { label: "Purchase Orders", href: "/inventory/purchase-orders" },
  { label: "Procurement", href: "/inventory/procurement" },
  { label: "Transfers", href: "/inventory/transfers" },
  { label: "Waste", href: "/inventory/waste" },
];

export function InventoryTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Inventory sections" className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
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
