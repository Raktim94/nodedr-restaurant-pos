// Pure basket logic for the self-service kiosk. No React, no imports, so it is
// unit-testable with `node --test`. Money here is PREVIEW ONLY: the server
// recomputes every price, modifier and tax figure and is authoritative (see
// backend orders/pricing.ts, which these two helpers mirror). The kiosk
// confirmation always shows the server's totals, never these.

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Mirrors backend toEffectiveInclusiveUnitPrice: EXCLUSIVE menus gross up. */
export function toInclusiveUnitPrice(
  rawUnitPrice: number,
  taxRatePercent: number,
  taxMode: "INCLUSIVE" | "EXCLUSIVE",
): number {
  if (taxMode === "EXCLUSIVE" && taxRatePercent > 0) {
    return round2(rawUnitPrice * (1 + taxRatePercent / 100));
  }
  return round2(rawUnitPrice);
}

export interface BasketLine {
  /** item id + sorted modifier ids: same item, same options => same line */
  key: string;
  menuItemId: string;
  name: string;
  modifierIds: string[];
  modifierLabel: string;
  unitPrice: number;
  quantity: number;
}

export const MAX_LINE_QUANTITY = 20;
export const MAX_LINES = 50;

export function lineKey(menuItemId: string, modifierIds: string[]): string {
  return `${menuItemId}:${[...modifierIds].sort().join(",")}`;
}

export function addToBasket(
  basket: BasketLine[],
  line: Omit<BasketLine, "key" | "quantity">,
): BasketLine[] {
  const key = lineKey(line.menuItemId, line.modifierIds);
  const existing = basket.find((l) => l.key === key);
  if (existing) {
    return basket.map((l) =>
      l.key === key ? { ...l, quantity: Math.min(l.quantity + 1, MAX_LINE_QUANTITY) } : l,
    );
  }
  if (basket.length >= MAX_LINES) return basket;
  return [...basket, { ...line, key, quantity: 1 }];
}

/** Change a line by delta; reaching 0 removes it. Unknown keys are ignored. */
export function changeQuantity(basket: BasketLine[], key: string, delta: number): BasketLine[] {
  return basket
    .map((l) =>
      l.key === key ? { ...l, quantity: Math.min(l.quantity + delta, MAX_LINE_QUANTITY) } : l,
    )
    .filter((l) => l.quantity > 0);
}

export function removeLine(basket: BasketLine[], key: string): BasketLine[] {
  return basket.filter((l) => l.key !== key);
}

export function removeItems(basket: BasketLine[], menuItemIds: string[]): BasketLine[] {
  const gone = new Set(menuItemIds);
  return basket.filter((l) => !gone.has(l.menuItemId));
}

export function basketCount(basket: BasketLine[]): number {
  return basket.reduce((sum, l) => sum + l.quantity, 0);
}

export function basketTotal(basket: BasketLine[]): number {
  return round2(basket.reduce((sum, l) => sum + round2(l.unitPrice * l.quantity), 0));
}

export function toOrderItems(basket: BasketLine[]) {
  return basket.map((l) => ({
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    modifierIds: l.modifierIds,
  }));
}
