// Single source of truth for the granular permission list (spec: "Every
// permission should be individually configurable"). Backend seeds these as
// Permission rows; frontend uses the same keys to gate UI (buttons/routes).
// Extend this list as later-phase modules land — never hardcode a role
// check in business logic, always check a permission key.

export const PERMISSIONS = [
  { key: "sales.view", label: "View Sales", category: "Sales" },
  { key: "orders.create", label: "Create Orders", category: "Orders" },
  { key: "orders.edit", label: "Edit Orders", category: "Orders" },
  { key: "orders.cancel", label: "Cancel Orders", category: "Orders" },
  { key: "discounts.apply", label: "Apply Discounts", category: "Orders" },
  { key: "refunds.process", label: "Process Refunds", category: "Orders" },
  { key: "bills.print", label: "Print Bills", category: "Orders" },
  { key: "tables.manage", label: "Manage Tables", category: "Tables" },
  { key: "menu.manage", label: "Manage Menu", category: "Menu" },
  { key: "inventory.manage", label: "Manage Inventory", category: "Inventory" },
  { key: "reports.access", label: "Access Reports", category: "Reports" },
  { key: "users.manage", label: "Manage Users", category: "Admin" },
  { key: "reports.financial.view", label: "View Financial Reports", category: "Reports" },
  { key: "data.export", label: "Export Data", category: "Reports" },
  { key: "kds.manage", label: "Manage Kitchen Display", category: "Kitchen" },
  { key: "reservations.manage", label: "Manage Reservations", category: "Reservations" },
  { key: "settings.manage", label: "Manage Settings", category: "Admin" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const STAFF_ROLES = [
  "OWNER",
  "ADMINISTRATOR",
  "RESTAURANT_MANAGER",
  "CASHIER",
  "WAITER",
  "KITCHEN_STAFF",
  "CHEF",
  "BARTENDER",
  "DELIVERY_STAFF",
  "ACCOUNTANT",
  "INVENTORY_MANAGER",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

// Default permission bundles per role — seeded on first boot, but every
// permission remains individually toggleable afterward (stored per-role in
// the DB, this is just the initial grant set).
export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRole, PermissionKey[]> = {
  OWNER: PERMISSIONS.map((p) => p.key),
  ADMINISTRATOR: PERMISSIONS.map((p) => p.key),
  RESTAURANT_MANAGER: [
    "sales.view", "orders.create", "orders.edit", "orders.cancel",
    "discounts.apply", "bills.print", "tables.manage", "menu.manage",
    "inventory.manage", "reports.access", "kds.manage",
    "reservations.manage",
  ],
  CASHIER: ["orders.create", "orders.edit", "bills.print", "discounts.apply", "sales.view"],
  WAITER: ["orders.create", "orders.edit", "tables.manage", "bills.print"],
  KITCHEN_STAFF: ["kds.manage"],
  CHEF: ["kds.manage", "menu.manage"],
  BARTENDER: ["orders.create", "kds.manage"],
  DELIVERY_STAFF: ["orders.edit"],
  ACCOUNTANT: ["sales.view", "reports.access", "reports.financial.view", "data.export"],
  INVENTORY_MANAGER: ["inventory.manage", "reports.access"],
};
