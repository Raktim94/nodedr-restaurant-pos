// Bill arithmetic for the standalone POS. It mirrors the server (pricing.ts and
// settlement.ts): menu prices are tax-inclusive, tax is the part of the price
// that is tax, and a discount reduces the price and the tax pro-rata.
// Kept free of the page so it can be unit tested.

export const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Price one unit really costs the guest: grossed up only for tax-exclusive branches. */
export function effectiveUnit(price, taxRate, taxMode) {
  return taxMode === 'EXCLUSIVE' && taxRate > 0 ? round2(price * (1 + taxRate / 100)) : round2(price);
}

export function priceLine({ price, quantity, taxRate, taxMode }) {
  const lineTotal = round2(effectiveUnit(price, taxRate, taxMode) * quantity);
  const rate = taxRate / 100;
  const tax = rate > 0 ? round2(lineTotal - lineTotal / (1 + rate)) : 0;
  return { lineTotal, tax };
}

/** cart: [{ price, quantity, taxRate }] */
export function computeBill(cart, { taxMode = 'INCLUSIVE', discountPercent = 0, discountFlat = 0 } = {}) {
  const lines = cart.map((c) => priceLine({ ...c, taxMode }));
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const rawTax = round2(lines.reduce((s, l) => s + l.tax, 0));
  const percentDiscount = round2((subtotal * discountPercent) / 100);
  const discountAmount = round2(Math.min(percentDiscount + discountFlat, subtotal));
  const total = round2(subtotal - discountAmount);
  const tax = subtotal > 0 ? round2((rawTax * (subtotal - discountAmount)) / subtotal) : 0;
  return { lines, subtotal, discountAmount, tax, total };
}

/**
 * Turns what the cashier typed into payment rows the server accepts.
 * Cash handed over above the total is change, not a bigger payment.
 */
export function settle(total, tenders) {
  const rows = [];
  let remaining = total;
  let change = 0;
  for (const t of tenders) {
    if (!(t.amount > 0)) continue;
    if (t.method === 'CASH' && t.amount > remaining) {
      const applied = round2(remaining);
      if (applied > 0) rows.push({ method: 'CASH', amount: applied, tendered: round2(t.amount) });
      change = round2(t.amount - applied);
      remaining = 0;
    } else {
      const applied = round2(Math.min(t.amount, remaining));
      if (applied > 0) rows.push({ method: t.method, amount: applied, ...(t.reference ? { reference: t.reference } : {}) });
      remaining = round2(remaining - applied);
    }
  }
  return { rows, change, balance: round2(Math.max(remaining, 0)), fullyPaid: remaining <= 0.004 };
}

/** The UPI deep link for the amount due (NPCI linking spec), as the server prints it. */
export function upiLink({ vpa, name, amount, note, ref }) {
  const q = new URLSearchParams();
  q.set('pa', vpa);
  if (name) q.set('pn', String(name).slice(0, 60));
  if (amount > 0) q.set('am', amount.toFixed(2));
  q.set('cu', 'INR');
  if (note) q.set('tn', String(note).slice(0, 60));
  if (ref) q.set('tr', String(ref).slice(0, 35));
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}
