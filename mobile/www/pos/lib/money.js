// Amounts in a snapshot are already priced in the restaurant's currency.
export function currencyCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

export const saleCurrency = (sale, restaurant) =>
  currencyCode(sale?.currency) || currencyCode(restaurant.legacySaleCurrency) || currencyCode(restaurant.currency);

const formats = new Map();
export function formatMoney(value, currency, locale = globalThis.navigator?.language, thermal = false) {
  const code = currencyCode(currency);
  const key = [locale, code, thermal].join('|');
  let format = formats.get(key);
  if (!format) {
    const options = code ? { style: 'currency', currency: code } : { minimumFractionDigits: 2 };
    if (thermal) Object.assign(options, { numberingSystem: 'latn', currencyDisplay: 'code' });
    // The ledger records two decimals, including fractional amounts for zero-minor-unit currencies.
    format = new Intl.NumberFormat(locale, { ...options, maximumFractionDigits: 2 });
    formats.set(key, format);
  }
  const amount = format.format(value);
  return thermal ? amount.replace(/[\u00a0\u202f]/g, ' ').replace(/[\u061c\u200e\u200f]/g, '').replace(/’/g, "'") : amount;
}

export const supportsUpi = (currency) => currencyCode(currency) === 'INR';
