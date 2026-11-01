/**
 * Website / app-ordering price change set in Settings: a percentage or a flat
 * amount per item, cheaper (negative) or costlier (positive). The same function
 * prices the menu a website shows and the order it places, so the two can
 * never disagree. Never goes below zero; rounded to paise.
 */
export type OnlinePriceAdjust = { kind: 'PERCENT' | 'AMOUNT'; value: number };

export function adjustOnlinePrice(
  price: number,
  adj: OnlinePriceAdjust | null,
): number {
  if (!adj || !adj.value) return price;
  const next =
    adj.kind === 'PERCENT' ? price * (1 + adj.value / 100) : price + adj.value;
  return Math.max(Math.round(next * 100) / 100, 0);
}

export function onlinePriceAdjustOf(r: {
  onlinePriceAdjustKind: string;
  onlinePriceAdjustValue: unknown;
}): OnlinePriceAdjust | null {
  const value = Number(r.onlinePriceAdjustValue);
  if (!value) return null;
  return {
    kind: r.onlinePriceAdjustKind === 'AMOUNT' ? 'AMOUNT' : 'PERCENT',
    value,
  };
}
