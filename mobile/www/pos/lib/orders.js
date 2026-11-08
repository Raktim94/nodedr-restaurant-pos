// Open orders, tables and the day's figures for the standalone POS.
// Pure functions: no page, no database, so they are unit tested.
import { round2 } from './bill.js';

export const OPEN = 'OPEN';

export function newOrder({ id, number, type = 'TAKEAWAY', tableId = '', tableLabel = '', now = new Date() }) {
  return {
    id,
    number, // e.g. "ORD-241108-003" (also shown as the held-order name)
    type,
    tableId,
    tableLabel,
    status: OPEN,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    items: [], // { menuItemId, name, price, taxRate, qty, sent, note }
    discountPercent: 0,
    kotNumbers: [],
  };
}

/**
 * What the kitchen still has to be told: more of a dish than it was sent
 * (`add`), or fewer (`cancel` - the kitchen may already be cooking it).
 */
export function kotDelta(order) {
  const add = [];
  const cancel = [];
  for (const l of order.items) {
    const diff = l.qty - (l.sent || 0);
    if (diff > 0) add.push({ menuItemId: l.menuItemId, name: l.name, qty: diff, note: l.note || '' });
    if (diff < 0) cancel.push({ menuItemId: l.menuItemId, name: l.name, qty: -diff, note: l.note || '' });
  }
  return { add, cancel, empty: add.length === 0 && cancel.length === 0 };
}

/** Remember that the kitchen now knows about everything on the order. */
export function markSent(order, kotNumber) {
  for (const l of order.items) l.sent = l.qty;
  order.kotNumbers = [...(order.kotNumbers || []), kotNumber];
  return order;
}

/** Orders that still hold a table or a place in the queue. */
export const openOrders = (orders) => orders.filter((o) => o.status === OPEN && (o.items.some((l) => l.qty > 0) || (o.kotNumbers || []).length));

/** table label -> { order } for tables with an open order. Two orders on one table is a conflict the caller must prevent. */
export function tableMap(orders) {
  const m = new Map();
  for (const o of openOrders(orders)) if (o.type === 'DINE_IN' && o.tableLabel && !m.has(o.tableLabel)) m.set(o.tableLabel, o);
  return m;
}

/** Is this table taken by an order other than `exceptId`? */
export const tableTakenBy = (orders, label, exceptId) => openOrders(orders).find((o) => o.id !== exceptId && o.type === 'DINE_IN' && o.tableLabel === label) || null;

export function minutesSince(iso, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

/** Kitchen ticket status flow. */
export const KOT_NEXT = { NEW: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };

const sameDay = (iso, now) => {
  const a = new Date(iso);
  return a.getFullYear() === now.getFullYear() && a.getMonth() === now.getMonth() && a.getDate() === now.getDate();
};

/**
 * Figures for one calendar day on this phone. `sales` are completed sales
 * (any sync state); `orders` supply the voids. The day is the phone's local day.
 */
export function dayReport(sales, orders, now = new Date()) {
  const todays = sales.filter((s) => sameDay(s.soldAt, now));
  const byMethod = { CASH: 0, UPI: 0, CARD: 0, OTHER: 0 };
  const items = new Map();
  let total = 0;
  let tax = 0;
  let discount = 0;
  for (const s of todays) {
    total += s.bill.total;
    tax += s.bill.tax;
    discount += s.bill.discountAmount;
    for (const p of s.payments) byMethod[p.method] = round2((byMethod[p.method] || 0) + p.amount);
    for (const i of s.items) items.set(i.name, (items.get(i.name) || 0) + i.quantity);
  }
  const voids = orders.filter((o) => o.status === 'VOID' && o.voidedAt && sameDay(o.voidedAt, now));
  return {
    count: todays.length,
    total: round2(total),
    tax: round2(tax),
    discount: round2(discount),
    byMethod,
    top: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    notSynced: todays.filter((s) => s.status === 'pending').length,
    needAttention: todays.filter((s) => s.status === 'refused').length,
    voids: voids.length,
    voidValue: round2(voids.reduce((n, o) => n + o.items.reduce((m, l) => m + l.price * l.qty, 0), 0)),
  };
}

/** One line for the server's order notes: what the kitchen was told about each dish. */
export function saleNote(items) {
  const parts = items.filter((i) => i.note).map((i) => `${i.quantity}x ${i.name}: ${i.note}`);
  return parts.length ? `Notes - ${parts.join('; ')}`.slice(0, 300) : undefined;
}
