"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Boxes, 
  MapPin, 
  ClipboardCheck, 
  ShoppingCart, 
  BookOpen, 
  FileSpreadsheet, 
  ChefHat, 
  Factory, 
  Building2, 
  FileText, 
  Truck, 
  ArrowLeftRight, 
  Trash2,
  ChevronDown
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TabItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface TabGroup {
  name: string;
  icon: React.ElementType;
  items: TabItem[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    name: "Stock & Storage",
    icon: Boxes,
    items: [
      { label: "Stock items", href: "/inventory", icon: Boxes },
      { label: "Storage areas", href: "/inventory/areas", icon: MapPin },
      { label: "Stock take", href: "/inventory/stock-take", icon: ClipboardCheck },
      { label: "Shopping list", href: "/inventory/shopping-list", icon: ShoppingCart },
    ],
  },
  {
    name: "Production & Prep",
    icon: ChefHat,
    items: [
      { label: "Daily production", href: "/inventory/production", icon: ChefHat },
      { label: "Transfers", href: "/inventory/transfers", icon: ArrowLeftRight },
      { label: "Waste log", href: "/inventory/waste", icon: Trash2 },
    ],
  },
  {
    name: "Purchasing",
    icon: Building2,
    items: [
      { label: "Suppliers", href: "/inventory/suppliers", icon: Building2 },
      { label: "Purchase orders", href: "/inventory/purchase-orders", icon: FileText },
      { label: "Procurement", href: "/inventory/procurement", icon: Truck },
    ],
  },
  {
    name: "Reports & Logs",
    icon: FileSpreadsheet,
    items: [
      { label: "Stock journal", href: "/inventory/journal", icon: BookOpen },
      { label: "Stock report", href: "/inventory/stock-report", icon: FileSpreadsheet },
      { label: "Mfg reports", href: "/inventory/manufacturing-reports", icon: Factory },
      { label: "Yield analysis", href: "/inventory/yield-analysis", icon: FileSpreadsheet },
    ],
  },
];

export function InventoryTabs() {
  const pathname = usePathname();

  const isItemActive = (href: string) => {
    if (href === "/inventory") {
      return pathname === "/inventory";
    }
    return pathname?.startsWith(href);
  };

  const getActiveGroup = () => {
    for (const group of TAB_GROUPS) {
      if (group.items.some((item) => isItemActive(item.href))) {
        return group.name;
      }
    }
    return TAB_GROUPS[0].name;
  };

  const activeGroupName = getActiveGroup();

  return (
    <div className="flex flex-col gap-2.5 border-b border-border/70 pb-3">
      {/* Top Level Section Segmented Control Bar */}
      <nav
        aria-label="Inventory sections"
        className="flex items-center gap-1 p-1 bg-muted/60 dark:bg-muted/40 rounded-2xl w-full sm:w-fit overflow-x-auto scrollbar-none border border-border/50"
      >
        {TAB_GROUPS.map((group) => {
          const isGroupActive = group.name === activeGroupName;
          const GroupIcon = group.icon;

          return (
            <Link
              key={group.name}
              href={group.items[0].href}
              className={cn(
                "flex items-center justify-center gap-2 px-3 sm:px-3.5 py-1.5 min-h-[38px] rounded-xl text-xs font-medium transition-all shrink-0 active:scale-97 select-none",
                isGroupActive
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/60"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <GroupIcon className={cn("h-3.5 w-3.5", isGroupActive ? "text-primary" : "text-muted-foreground")} />
              <span>{group.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Secondary Sub-navigation Pills: Scoped to the Selected Section */}
      <nav
        aria-label="Sub-navigation"
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-0.5"
      >
        {TAB_GROUPS.find((g) => g.name === activeGroupName)?.items.map((item) => {
          const active = isItemActive(item.href);
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 min-h-[34px] text-xs font-medium transition-all shrink-0 active:scale-97",
                active
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border/40"
              )}
            >
              <ItemIcon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
