// The restaurant's books on this phone: refunds, expenses, the cash drawer and
// exports. Pure functions (no page, no database) so they are unit tested.
import { effectiveUnit, round2 } from './bill.js';

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dayOf = (iso) => dayKey(new Date(iso));
export const today = (now = new Date()) => dayKey(now);

// ------------------------------------------------------------------ refunds ---

/** Quantity of each sale line that can still be refunded. */
export function refundableLines(sale, refunds) {
  const left = sale.items.map((i) => i.quantity);
  for (const r of refunds.filter((x) => x.saleId === sale.id))
    for (const l of r.lines) if (left[l.index] != null) left[l.index] -= l.qty;
  return sale.items.map((item, index) => ({ index, item, left: Math.max(0, left[index]) }));
}

export const refundedTotal = (sale, refunds) => round2(refunds.filter((r) => r.saleId === sale.id).reduce((n, r) => n + r.amount, 0));

/**
 * What one unit of each line is worth of the money actually paid: the sale
 * total is shared across the lines by their (tax-inclusive) price, so a bill
 * with a discount refunds the discounted amount, never more than was paid.
 */
function unitValues(sale) {
  const mode = sale.taxMode || 'INCLUSIVE';
  const weights = sale.items.map((i) => effectiveUnit(i.price, i.taxRate, mode) * i.quantity);
  const sum = weights.reduce((a, b) => a + b, 0);
  return sale.items.map((i, k) => (sum > 0 ? (sale.bill.total * weights[k]) / sum / i.quantity : 0));
}

/**
 * Build a refund. `picks` is [{ index, qty }] of sale lines. The last refund
 * of a sale takes exactly what is left of what was paid, so rounding never
 * leaves a few paise stranded or refunds more than the customer paid.
 */
export function buildRefund({ id, sale, refunds, picks, method = 'CASH', reason = '', now = new Date() }) {
  const avail = refundableLines(sale, refunds);
  const unit = unitValues(sale);
  const lines = [];
  let amount = 0;
  for (const p of picks) {
    const qty = Number(p.qty) || 0;
    if (qty <= 0) continue;
    const a = avail[p.index];
    if (!a) throw new Error('That dish is not on this sale.');
    if (qty > a.left) throw new Error(`Only ${a.left} of ${a.item.name} can still be refunded.`);
    lines.push({ index: p.index, name: a.item.name, qty, price: a.item.price });
    amount += unit[p.index] * qty;
  }
  if (!lines.length) throw new Error('Choose at least one dish to refund.');
  amount = round2(amount);
  const remaining = round2(sale.bill.total - refundedTotal(sale, refunds));
  const takesEverything = refundableLines(sale, [...refunds, { saleId: sale.id, lines }]).every((l) => l.left === 0);
  if (takesEverything) amount = remaining;
  amount = Math.min(amount, remaining);
  if (!(amount > 0)) throw new Error('Nothing is left to refund on this sale.');
  const tax = sale.bill.total > 0 ? round2((sale.bill.tax * amount) / sale.bill.total) : 0;
  return { id, saleId: sale.id, localNumber: sale.localNumber, at: now.toISOString(), lines, amount, tax, method, reason: String(reason || '').trim().slice(0, 200) };
}

// ----------------------------------------------------------------- expenses ---

export function buildExpense({ id, amount, note, category, method = 'CASH', now = new Date() }) {
  amount = round2(Number(amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the amount, for example 250.');
  note = String(note || '').trim();
  if (!note) throw new Error('Say what it was for, for example Vegetables.');
  return { id, at: now.toISOString(), amount, note: note.slice(0, 120), category: String(category || '').trim().slice(0, 40), method: method === 'CASH' ? 'CASH' : 'OTHER' };
}

// ---------------------------------------------------------------- the books ---

const inDay = (iso, key) => dayOf(iso) === key;

/** One day's money on this phone. `float` is the cash in the drawer when the day opened. */
export function dayBooks({ sales, refunds, expenses, float = 0, day = today() }) {
  const s = sales.filter((x) => inDay(x.soldAt, day));
  const r = refunds.filter((x) => inDay(x.at, day));
  const e = expenses.filter((x) => inDay(x.at, day));
  const byMethod = { CASH: 0, UPI: 0, CARD: 0, OTHER: 0 };
  let gross = 0;
  let tax = 0;
  let discount = 0;
  for (const x of s) {
    gross += x.bill.total;
    tax += x.bill.tax;
    discount += x.bill.discountAmount;
    for (const p of x.payments) byMethod[p.method] = round2((byMethod[p.method] || 0) + p.amount);
  }
  const refundTotal = round2(r.reduce((n, x) => n + x.amount, 0));
  const refundCash = round2(r.filter((x) => x.method === 'CASH').reduce((n, x) => n + x.amount, 0));
  const refundTax = round2(r.reduce((n, x) => n + x.tax, 0));
  const expenseTotal = round2(e.reduce((n, x) => n + x.amount, 0));
  const expenseCash = round2(e.filter((x) => x.method === 'CASH').reduce((n, x) => n + x.amount, 0));
  return {
    day,
    sales: s.length,
    gross: round2(gross),
    refundTotal,
    net: round2(gross - refundTotal),
    tax: round2(tax - refundTax),
    discount: round2(discount),
    byMethod,
    expenseTotal,
    expenseCash,
    profit: round2(gross - refundTotal - expenseTotal),
    // Cash that should be in the drawer: float + cash taken - cash paid out.
    expectedCash: round2(Number(float || 0) + byMethod.CASH - refundCash - expenseCash),
  };
}

/** Total of net sales, refunds and expenses between two day keys (inclusive). */
export function rangeBooks({ sales, refunds, expenses, from, to }) {
  const within = (iso) => {
    const k = dayOf(iso);
    return k >= from && k <= to;
  };
  const s = sales.filter((x) => within(x.soldAt));
  const items = new Map();
  for (const x of s) for (const i of x.items) items.set(i.name, (items.get(i.name) || 0) + i.quantity);
  const gross = round2(s.reduce((n, x) => n + x.bill.total, 0));
  const refundTotal = round2(refunds.filter((x) => within(x.at)).reduce((n, x) => n + x.amount, 0));
  const expenseTotal = round2(expenses.filter((x) => within(x.at)).reduce((n, x) => n + x.amount, 0));
  return {
    from,
    to,
    sales: s.length,
    gross,
    refundTotal,
    net: round2(gross - refundTotal),
    expenseTotal,
    profit: round2(gross - refundTotal - expenseTotal),
    top: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name, qty })),
  };
}

export function daysAgo(n, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return dayKey(d);
}

/** What the cashier counted against what the books say should be there. */
export function closeDay({ books, counted, now = new Date() }) {
  counted = round2(Number(counted));
  if (!Number.isFinite(counted) || counted < 0) throw new Error('Enter the cash you counted, for example 5400.');
  return {
    day: books.day,
    closedAt: now.toISOString(),
    expectedCash: books.expectedCash,
    countedCash: counted,
    difference: round2(counted - books.expectedCash), // negative = cash is short
    net: books.net,
    gross: books.gross,
    refundTotal: books.refundTotal,
    expenseTotal: books.expenseTotal,
    sales: books.sales,
  };
}

// ------------------------------------------------------------------- export ---

/** One CSV cell: quoted when needed, and never starting with a formula character. */
export function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (a) => a.map(cell).join(',');

export function salesCsv(sales, refunds = []) {
  const head = ['Bill', 'Server order', 'Date', 'Time', 'Type', 'Table', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Refunded', 'Payments', 'Status'];
  const out = [row(head)];
  for (const s of [...sales].sort((a, b) => (a.soldAt < b.soldAt ? -1 : 1))) {
    const d = new Date(s.soldAt);
    out.push(
      row([
        s.localNumber,
        s.serverOrderNumber || '',
        dayKey(d),
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        s.type,
        s.tableLabel || '',
        s.items.map((i) => `${i.quantity} x ${i.name}`).join('; '),
        s.bill.subtotal,
        s.bill.discountAmount,
        s.bill.tax,
        s.bill.total,
        refundedTotal(s, refunds),
        s.payments.map((p) => `${p.method} ${p.amount}`).join('; '),
        s.status,
      ]),
    );
  }
  return out.join('\r\n') + '\r\n';
}

export function expensesCsv(expenses) {
  const out = [row(['Date', 'Time', 'What for', 'Category', 'Paid by', 'Amount'])];
  for (const e of [...expenses].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    const d = new Date(e.at);
    out.push(row([dayKey(d), `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, e.note, e.category, e.method === 'CASH' ? 'Cash' : 'Other', e.amount]));
  }
  return out.join('\r\n') + '\r\n';
}

export const BACKUP_FORMAT = 'orderrestro-standalone-backup';

/** Everything on the phone (never the password) as one JSON file. */
export function backupJson(data, now = new Date()) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, savedAt: now.toISOString(), ...data });
}

/** Parse and sanity-check a backup file; throws a plain message when it is not one of ours. */
export function parseBackup(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error('That file is not an OrderRestro backup.');
  }
  if (!b || b.format !== BACKUP_FORMAT) throw new Error('That file is not an OrderRestro backup.');
  if (b.version !== 1) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  const arr = (x) => (Array.isArray(x) ? x : []);
  if (!b.snapshot || !Array.isArray(b.snapshot.items)) throw new Error('The backup has no menu in it.');
  return { snapshot: b.snapshot, sales: arr(b.sales), orders: arr(b.orders), kots: arr(b.kots), refunds: arr(b.refunds), expenses: arr(b.expenses), shifts: arr(b.shifts), savedAt: b.savedAt };
}
