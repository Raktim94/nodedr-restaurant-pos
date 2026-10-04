import {
  CalendarClock,
  Clock,
  ChefHat,
  LayoutDashboard,
  ClipboardList,
  LayoutGrid,
  Package,
  Settings,
  ShoppingCart,
  UsersRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  labelKey: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
  { labelKey: "nav.pos", href: "/pos", icon: ShoppingCart, permission: "orders.create" },
  { labelKey: "nav.orders", href: "/orders", icon: ClipboardList, permission: "orders.create" },
  { labelKey: "nav.tables", href: "/tables", icon: LayoutGrid, permission: "tables.manage" },
  {
    labelKey: "nav.reservations",
    href: "/reservations",
    icon: CalendarClock,
    permission: "reservations.manage",
  },
  { labelKey: "nav.menu", href: "/menu", icon: UtensilsCrossed, permission: "menu.manage" },
  { labelKey: "nav.kds", href: "/kds", icon: ChefHat, permission: "kds.manage" },
  { labelKey: "nav.customers", href: "/customers", icon: UsersRound, permission: "customers.manage" },
  { labelKey: "nav.inventory", href: "/inventory", icon: Package, permission: "inventory.manage" },
  { labelKey: "nav.attendance", href: "/attendance", icon: Clock },
  { labelKey: "nav.settings", href: "/settings", icon: Settings, permission: "settings.manage" },
];
