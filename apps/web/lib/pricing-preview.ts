// Client-side PREVIEW ONLY, mirrors backend/src/modules/orders/pricing.ts.
// The server always recomputes and is authoritative — this exists purely so
// the POS screen can show a live running total while building the cart.
// Keep this in sync with the backend file if the tax model ever changes;
// see ARCHITECTURE.md for why prices are tax-inclusive.

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Mirror of backend toEffectiveInclusiveUnitPrice. An EXCLUSIVE menu stores
 * pre-tax prices, so every preview must gross them up before showing them or
 * the screen disagrees with the bill the server produces.
 */
export function toInclusivePrice(
  rawPrice: number,
  taxRatePercent: number,
  taxMode: "INCLUSIVE" | "EXCLUSIVE",
): number {
  if (taxMode === "EXCLUSIVE" && taxRatePercent > 0) {
    return round2(rawPrice * (1 + taxRatePercent / 100));
  }
  return round2(rawPrice);
}

export function lineTotal(unitPriceInclusive: number, quantity: number): number {
  return round2(unitPriceInclusive * quantity);
}

export function subtotalOf(lines: number[]): number {
  return round2(lines.reduce((sum, l) => sum + l, 0));
}
