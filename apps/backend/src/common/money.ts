// Shared rounding for money and inventory quantities.

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export class SaleCurrencyMismatch extends Error {
  readonly code = 'CURRENCY_MISMATCH';
}

export function assertSaleCurrency(
  saleCurrency: string,
  restaurantCurrency: string,
) {
  if (saleCurrency !== restaurantCurrency.trim().toUpperCase()) {
    throw new SaleCurrencyMismatch(
      `This sale was taken in ${saleCurrency}. The restaurant currently uses ${restaurantCurrency}.`,
    );
  }
}

/** Format the stored POS amount in the restaurant currency. */
export function moneyFormatter(currency: string, locale = 'en') {
  // Older installations permitted a free-text currency in Settings.
  const valid = /^[a-z]{3}$/i.test(currency);
  return new Intl.NumberFormat(
    locale,
    valid
      ? { style: 'currency', currency, maximumFractionDigits: 2 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
}
