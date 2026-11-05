// Amounts sent to gateways are integers in the currency's smallest unit
// (Stripe, Razorpay) or a 2-decimal figure derived from those integers
// (Cashfree). Floats never reach a provider.

const ZERO_DECIMAL = new Set([
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'ISK',
  'UGX',
  'XAF',
  'XOF',
]);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** Order totals are 2-decimal; convert to the provider's integer minor units. */
export function toMinor(amount: number, currency: string): number {
  const cents = Math.round(amount * 100); // exact: totals have 2 decimals
  const exp = currencyExponent(currency);
  if (exp === 2) return cents;
  if (exp === 0) return Math.round(cents / 100);
  return cents * 10;
}

/** Integer minor units to a plain decimal number (e.g. 12345 INR -> 123.45). */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyExponent(currency);
}
