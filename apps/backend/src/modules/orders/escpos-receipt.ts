// Builds a raw ESC/POS byte buffer for direct-USB thermal printing — ported
// from nodedr-pos's backend/src/lib/escposReceipt.js and adapted to this
// app's Order/OrderItem data shape (see receipt.html.ts for the same data
// rendered as HTML instead). Fixed-width monospace grid at a known column
// count (42 for 80mm paper, 32 for 58mm) so plain string padding lines up
// exactly.
//
// Unicode limitation (unlike receipt.html.ts, which is full Unicode):
// generic ESC/POS thermal printers default to a single-byte codepage
// (usually CP437/PC850), not UTF-8. `toPrinterText` normalizes accented
// Latin letters down to their base letter and replaces anything else with
// "?" — a real, documented trade-off of the USB path specifically.

const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  init: Buffer.from([ESC, 0x40]),
  codepagePc437: Buffer.from([ESC, 0x74, 0x00]),
  alignLeft: Buffer.from([ESC, 0x61, 0x00]),
  boldOn: Buffer.from([ESC, 0x45, 0x01]),
  boldOff: Buffer.from([ESC, 0x45, 0x00]),
  feedAndCut: Buffer.concat([
    Buffer.from('\n\n\n\n'),
    Buffer.from([GS, 0x56, 0x00]),
  ]),
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: 'Rs.',
  USD: '$',
  EUR: 'EUR',
  GBP: 'GBP',
};

function toPrinterText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function center(s: string, width: number): string {
  s = s.slice(0, width);
  const total = width - s.length;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + s + ' '.repeat(total - left);
}

function row(label: string, value: string, width: number): string {
  label = String(label);
  value = String(value);
  const space = width - label.length - value.length;
  if (space < 1) {
    label = label.slice(0, Math.max(0, width - value.length - 1));
    return (
      label +
      ' '.repeat(Math.max(0, width - label.length - value.length)) +
      value
    );
  }
  return label + ' '.repeat(space) + value;
}

function rule(width: number): string {
  return '-'.repeat(width);
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toPrinterText(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      let w = word;
      while (w.length > width) {
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > width) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

export interface EscposReceiptOrder {
  orderNumber: string;
  type: string;
  createdAt: Date;
  table: { label: string } | null;
  customer: { name: string; phone: string | null } | null;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  loyaltyPointsRedeemed: number;
  loyaltyDiscountAmount: number;
  totalAmount: number;
  items: {
    nameSnapshot: string;
    quantity: number;
    unitPriceSnapshot: number;
    lineTotal: number;
    taxRateSnapshot: number;
    modifiers: { nameSnapshot: string; priceAdjSnapshot: number }[];
  }[];
  payments: { method: string; amount: number }[];
}

export function buildReceiptEscPos({
  restaurantName,
  branch,
  currency,
  order,
  width = 42,
}: {
  restaurantName: string;
  branch: {
    name: string;
    address: string | null;
    phone: string | null;
    gstNumber: string | null;
  };
  currency: string;
  order: EscposReceiptOrder;
  width?: number;
}): Buffer {
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const money = (n: number) => `${sym}${Number(n).toFixed(2)}`;
  const date = new Date(order.createdAt);

  const lines: { text: string; bold?: boolean }[] = [];
  const push = (s = '', opts: { bold?: boolean } = {}) =>
    lines.push({ text: s, ...opts });

  push(center(toPrinterText(restaurantName), width), { bold: true });
  push(center(toPrinterText(branch.name), width));
  if (branch.address)
    for (const l of wrap(branch.address, width)) push(center(l, width));
  if (branch.phone) push(center(toPrinterText(`Ph: ${branch.phone}`), width));
  if (branch.gstNumber)
    push(center(toPrinterText(`GSTIN: ${branch.gstNumber}`), width));
  push(rule(width));
  push(toPrinterText(date.toLocaleString()));
  push(
    toPrinterText(
      `Order: #${order.orderNumber} - ${order.type.replace('_', ' ')}`,
    ),
  );
  if (order.table) push(toPrinterText(`Table: ${order.table.label}`));
  if (order.customer) {
    const cust = `Guest: ${order.customer.name}${order.customer.phone ? ` - ${order.customer.phone}` : ''}`;
    for (const l of wrap(cust, width)) push(l);
  }
  push(rule(width));

  for (const item of order.items) {
    for (const l of wrap(item.nameSnapshot, width)) push(l);
    for (const mod of item.modifiers) {
      for (const l of wrap(`+ ${mod.nameSnapshot}`, width)) push(`  ${l}`);
    }
    push(
      row(
        `  ${item.quantity} x ${money(item.unitPriceSnapshot)}`,
        money(item.lineTotal),
        width,
      ),
    );
    if (Number(item.taxRateSnapshot) > 0) {
      push(`  GST @ ${item.taxRateSnapshot}%`);
    }
  }
  push(rule(width));

  push(row('Subtotal', money(order.subtotal), width));
  if (order.discountAmount > 0) {
    push(row('Discount', `-${money(order.discountAmount)}`, width));
  }
  if (order.taxAmount > 0) {
    // Prices are tax-inclusive — this is a breakup of tax already inside
    // the total above, not an additional charge (see ARCHITECTURE.md).
    const half = Math.round((order.taxAmount / 2 + Number.EPSILON) * 100) / 100;
    push(row('CGST (incl.)', money(half), width));
    push(row('SGST (incl.)', money(order.taxAmount - half), width));
  }
  if (order.loyaltyDiscountAmount > 0) {
    push(
      row(
        `Loyalty (${order.loyaltyPointsRedeemed} pts)`,
        `-${money(order.loyaltyDiscountAmount)}`,
        width,
      ),
    );
  }
  if (order.tipAmount > 0) {
    push(row('Tip', money(order.tipAmount), width));
  }
  push(rule(width));
  push(row('GRAND TOTAL', money(order.totalAmount), width), { bold: true });

  if (order.payments.length > 0) {
    push(rule(width));
    for (const p of order.payments) {
      push(row(`Paid (${p.method})`, money(p.amount), width));
    }
  }

  push(rule(width));
  push(center('Thank you! Visit again.', width));

  const segments = [CMD.init, CMD.codepagePc437, CMD.alignLeft];
  for (const { text, bold } of lines) {
    const lineBuffer = Buffer.from(`${text}\n`, 'latin1');
    segments.push(
      bold ? Buffer.concat([CMD.boldOn, lineBuffer, CMD.boldOff]) : lineBuffer,
    );
  }
  segments.push(CMD.feedAndCut);
  return Buffer.concat(segments);
}

export function buildTestSlip(): Buffer {
  return Buffer.concat([
    Buffer.from([ESC, 0x40]),
    Buffer.from([ESC, 0x61, 0x01]),
    Buffer.from([ESC, 0x45, 0x01]),
    Buffer.from('Nodedr OrderRestro\n'),
    Buffer.from([ESC, 0x45, 0x00]),
    Buffer.from('Printer test OK\n'),
    Buffer.from([ESC, 0x61, 0x00]),
    Buffer.from(`${new Date().toLocaleString()}\n`),
    Buffer.from('\n\n\n\n'),
    Buffer.from([GS, 0x56, 0x00]),
  ]);
}
