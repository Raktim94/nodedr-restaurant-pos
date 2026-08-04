import {
  CalendarClock,
  ChefHat,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Settings,
  ShoppingCart,
  UsersRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Point of Sale", href: "/pos", icon: ShoppingCart, permission: "orders.create" },
  { label: "Tables", href: "/tables", icon: LayoutGrid, permission: "tables.manage" },
  {
    label: "Reservations",
    href: "/reservations",
    icon: CalendarClock,
    permission: "reservations.manage",
  },
  { label: "Menu", href: "/menu", icon: UtensilsCrossed, permission: "menu.manage" },
  { label: "Kitchen Display", href: "/kds", icon: ChefHat, permission: "kds.manage" },
  { label: "Customers", href: "/customers", icon: UsersRound, permission: "customers.manage" },
  { label: "Inventory", href: "/inventory", icon: Package, permission: "inventory.manage" },
  { label: "Settings", href: "/settings", icon: Settings, permission: "settings.manage" },
];
