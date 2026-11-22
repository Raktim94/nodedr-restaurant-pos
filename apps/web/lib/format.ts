// The restaurant's configured currency, set once by the app shell when settings load. Call sites that do not
// pass a currency (most of them) follow it instead of silently showing rupees.
let defaultCurrency = "INR";
export function setDefaultCurrency(code?: string | null): void {
  if (code && /^[A-Za-z]{3}$/.test(code)) defaultCurrency = code.toUpperCase();
}

export function formatCurrency(
  value: number | string,
  currency = defaultCurrency,
  locale = "en-IN",
): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
