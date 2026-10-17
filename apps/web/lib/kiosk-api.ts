// Thin client for the public kiosk endpoints. Separate from lib/api.ts
// because the kiosk must tell "no connection" and "server broke" apart from
// "the server said no", and needs a hard timeout so a stalled network can't
// leave a customer staring at a spinner forever.

import type { KioskServiceType } from "@nodedr-restaurant/types";

export interface KioskModifier {
  id: string;
  name: string;
  priceAdjustment: string;
  isDefault: boolean;
}
export interface KioskModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  modifiers: KioskModifier[];
}
export interface KioskMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  taxRatePercent: string;
  isVeg: boolean;
  modifierGroups: { modifierGroup: KioskModifierGroup }[];
}
export interface KioskMenuCategory {
  id: string;
  name: string;
  items: KioskMenuItem[];
}
export interface KioskMenu {
  restaurantName: string;
  branchName: string;
  logoUrl: string | null;
  currency: string;
  country: string;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  taxLabel: string;
  services: { dineIn: boolean; takeaway: boolean };
  categories: KioskMenuCategory[];
}
export interface KioskOrderResult {
  orderNumber: string;
  createdAt: string;
  currency: string;
  items: { name: string; quantity: number; lineTotal: string }[];
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  paid: false;
}

export type KioskErrorKind = "network" | "server" | "rate" | "notFound" | "unavailable" | "rejected";

export class KioskApiError extends Error {
  constructor(
    public kind: KioskErrorKind,
    message: string,
    public unavailableItemIds: string[] = [],
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`/api/v1/public/kiosk/${path}`, {
      ...init,
      signal: ctrl.signal,
      // No cookies: this surface is anonymous by design.
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    // fetch() only rejects on connectivity problems or our abort.
    throw new KioskApiError("network", "No connection");
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) return (await res.json()) as T;

  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    code?: string;
    unavailableItemIds?: string[];
  };
  const message = typeof body.message === "string" ? body.message : "Request failed";
  if (res.status === 404) throw new KioskApiError("notFound", message);
  if (res.status === 429) throw new KioskApiError("rate", message);
  if (res.status === 409 && body.code === "ITEM_UNAVAILABLE") {
    throw new KioskApiError("unavailable", message, body.unavailableItemIds ?? []);
  }
  if (res.status >= 500 || res.status === 502 || res.status === 503 || res.status === 504) {
    throw new KioskApiError("server", message);
  }
  throw new KioskApiError("rejected", message);
}

export const kioskApi = {
  menu: (token: string) => call<KioskMenu>(token),
  order: (
    token: string,
    body: {
      requestId: string;
      serviceType: KioskServiceType;
      items: { menuItemId: string; quantity: number; modifierIds: string[] }[];
    },
  ) => call<KioskOrderResult>(`${token}/order`, { method: "POST", body: JSON.stringify(body) }),
};
