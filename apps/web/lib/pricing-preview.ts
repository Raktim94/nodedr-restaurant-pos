// Client-side PREVIEW ONLY, mirrors backend/src/modules/orders/pricing.ts.
// The server always recomputes and is authoritative — this exists purely so
// the POS screen can show a live running total while building the cart.
// Keep this in sync with the backend file if the tax model ever changes;
// see ARCHITECTURE.md for why prices are tax-inclusive.

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function lineTotal(unitPriceInclusive: number, quantity: number): number {
  return round2(unitPriceInclusive * quantity);
}

export function subtotalOf(lines: number[]): number {
  return round2(lines.reduce((sum, l) => sum + l, 0));
}
