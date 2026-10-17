export function formatCurrency(
  value: number | string,
  currency = "INR",
  locale = "en-IN",
): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
