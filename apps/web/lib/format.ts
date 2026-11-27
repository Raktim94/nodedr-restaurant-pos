import type { IngredientUnit, StaffRole } from "@nodedr-restaurant/types";

export function formatCurrency(
  value: number | string,
  currency?: string,
  locale?: string,
): string {
  // While settings load, never label a payment with another restaurant's currency.
  if (!currency || !/^[a-z]{3}$/i.test(currency)) return "—";
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

const ROLE_LABELS = {
  OWNER: "Owner",
  ADMINISTRATOR: "Administrator",
  RESTAURANT_MANAGER: "Restaurant manager",
  CASHIER: "Cashier",
  WAITER: "Waiter",
  KITCHEN_STAFF: "Kitchen staff",
  CHEF: "Chef",
  BARTENDER: "Bartender",
  DELIVERY_STAFF: "Delivery staff",
  ACCOUNTANT: "Accountant",
  INVENTORY_MANAGER: "Inventory manager",
  STOCK_JOURNAL_MANAGER: "Stock journal manager",
} satisfies Record<StaffRole, string>;

const CODE_LABELS: Record<string, string> = {
  DINE_IN: "Dine-in", DRIVE_THRU: "Drive-thru", QR_ORDER: "QR order",
  UPI: "UPI", SMS: "SMS", WHATSAPP: "WhatsApp", SOP: "SOP", OK: "OK",
  TEST_OK: "Test passed", UID_MISMATCH: "UID mismatch",
};

const UNIT_LABELS = {
  KG: "kg", G: "g", L: "L", ML: "mL", PIECE: "pcs", DOZEN: "doz.", PACK: "pack", BOX: "box",
} satisfies Record<IngredientUnit, string>;

/** Only for predefined API values. Custom names, notes and product labels stay verbatim. */
export function createStaffFormat(
  localeTag: string,
  t: (key: string, values?: Record<string, string | number>) => string,
  restaurantCurrency?: string,
) {
  return {
    localeTag,
    currency: (value: string | number, currency = restaurantCurrency) => formatCurrency(value, currency, localeTag),
    number(value: number, fractionDigits?: number) {
      return value.toLocaleString(localeTag, fractionDigits === undefined ? undefined : {
        minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
      });
    },
    quantity(value: string | number | null | undefined) {
      if (value == null || value === "") return "";
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return String(value);
      const decimals = typeof value === "string" ? value.match(/\.(\d+)$/)?.[1].length : undefined;
      return numeric.toLocaleString(localeTag, {
        minimumFractionDigits: Math.min(decimals ?? 0, 20), maximumFractionDigits: 20,
      });
    },
    unit(code: string | null | undefined) {
      if (!code) return "";
      return Object.hasOwn(UNIT_LABELS, code) ? t(UNIT_LABELS[code as IngredientUnit]) : code;
    },
    percent(value: number, fractionDigits?: number) {
      return (value / 100).toLocaleString(localeTag, {
        style: "percent", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits ?? 3,
      });
    },
    /** Date-only fields and business dates already have a calendar day, independent of the viewing device. */
    day(iso: string, options?: Intl.DateTimeFormatOptions) {
      return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString(localeTag, { ...options, timeZone: "UTC" });
    },
    role(name?: string, label = name ?? "") {
      return name && Object.hasOwn(ROLE_LABELS, name) ? t(ROLE_LABELS[name as StaffRole]) : label;
    },
    code(value: string) {
      const label = Object.hasOwn(CODE_LABELS, value)
        ? CODE_LABELS[value]
        : value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replaceAll("_", " ");
      return t(label);
    },
    label: t,
  };
}

export type StaffFormat = ReturnType<typeof createStaffFormat>;
