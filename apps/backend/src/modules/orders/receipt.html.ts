// Self-printing HTML receipt — ported from nodedr-pos's
// backend/src/lib/receipt.js (same 80mm-thermal-safe layout rules: @page
// margin 0, left-aligned body, box-sizing border-box so 80mm stays 80mm
// after padding). Loaded into a hidden iframe by the frontend
// (lib/print.ts), which calls window.print() itself; the inline script here
// is only a fallback for engines that block that cross-frame call.

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

function esc(value: string | number | null | undefined): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

interface ReceiptOrder {
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

export function buildReceiptHtml({
  restaurantName,
  branch,
  currency,
  order,
}: {
  restaurantName: string;
  branch: {
    name: string;
    address: string | null;
    phone: string | null;
    gstNumber: string | null;
  };
  currency: string;
  order: ReceiptOrder;
}): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const money = (n: number) => `${sym}${Number(n).toFixed(2)}`;
  const dateStr = new Date(order.createdAt).toLocaleString();

  const itemRows = order.items
    .map((item) => {
      const modifierLines = item.modifiers
        .map((m) => `<div class="sub">+ ${esc(m.nameSnapshot)}</div>`)
        .join('');
      return `
        <tr>
          <td>${esc(item.nameSnapshot)}${modifierLines}${
            Number(item.taxRateSnapshot) > 0
              ? `<div class="sub">GST @ ${item.taxRateSnapshot}%</div>`
              : ''
          }</td>
          <td class="num">${item.quantity}</td>
          <td class="num">${money(item.unitPriceSnapshot)}</td>
          <td class="num">${money(item.lineTotal)}</td>
        </tr>`;
    })
    .join('');

  const totalRows: [string, string][] = [['Subtotal', money(order.subtotal)]];
  if (order.discountAmount > 0) {
    totalRows.push(['Discount', `- ${money(order.discountAmount)}`]);
  }
  if (order.taxAmount > 0) {
    // Prices are tax-inclusive (see ARCHITECTURE.md) — this is a breakup of
    // tax already inside the total above, not an additional charge.
    const half = Math.round((order.taxAmount / 2 + Number.EPSILON) * 100) / 100;
    totalRows.push(['CGST (incl.)', money(half)]);
    totalRows.push(['SGST (incl.)', money(order.taxAmount - half)]);
  }
  if (order.loyaltyDiscountAmount > 0) {
    totalRows.push([
      `Loyalty (${order.loyaltyPointsRedeemed} pts)`,
      `- ${money(order.loyaltyDiscountAmount)}`,
    ]);
  }
  if (order.tipAmount > 0) {
    totalRows.push(['Tip', money(order.tipAmount)]);
  }

  const paymentRows = order.payments.map(
    (p) =>
      `<tr><td>Paid (${esc(p.method)})</td><td class="num">${money(p.amount)}</td></tr>`,
  );

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(order.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  html { margin: 0; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 4mm; color: #111; width: 80mm; }
  p { margin: 0 0 3px; }
  .receipt { width: 100%; margin: 0; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
  .center { text-align: center; }
  .muted { color: #555; font-size: 11px; line-height: 1.35; }
  .rule { border: none; border-top: 1px dashed #999; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #777; padding-bottom: 2px; }
  td { padding: 1px 0; vertical-align: top; word-break: break-word; }
  .num { text-align: right; white-space: nowrap; padding-left: 6px; }
  .sub { font-size: 10px; color: #777; }
  .totals td { padding: 1px 0; }
  .grand td { font-weight: 700; font-size: 13px; border-top: 1px solid #111; padding-top: 3px; }
  .footer { text-align: center; margin-top: 6px; font-size: 11px; }
  @page { size: 80mm auto; margin: 0; }
  @media print {
    html, body { width: 80mm; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <script>
    window.addEventListener('message', function (e) { if (e.data === 'print') window.print(); });
  </script>
  <div class="receipt">
    <h1>${esc(restaurantName)}</h1>
    <p class="center muted">
      ${esc(branch.name)}${branch.address ? `<br>${esc(branch.address)}` : ''}
      ${branch.phone ? `<br>Ph: ${esc(branch.phone)}` : ''}
      ${branch.gstNumber ? `<br>GSTIN: ${esc(branch.gstNumber)}` : ''}
    </p>
    <hr class="rule">
    <p class="muted">
      ${esc(dateStr)}<br>
      Order: #${esc(order.orderNumber)} · ${esc(order.type.replace('_', ' '))}
      ${order.table ? `<br>Table: ${esc(order.table.label)}` : ''}
      ${order.customer ? `<br>Guest: ${esc(order.customer.name)}${order.customer.phone ? ` · ${esc(order.customer.phone)}` : ''}` : ''}
    </p>
    <hr class="rule">
    <table>
      <thead>
        <tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <hr class="rule">
    <table class="totals">
      ${totalRows.map(([l, v]) => `<tr><td>${esc(l)}</td><td class="num">${esc(v)}</td></tr>`).join('')}
      <tr class="grand"><td>GRAND TOTAL</td><td class="num">${money(order.totalAmount)}</td></tr>
    </table>
    ${
      paymentRows.length > 0
        ? `<hr class="rule"><table class="totals">${paymentRows.join('')}</table>`
        : ''
    }
    <hr class="rule">
    <p class="footer">Thank you! Visit again.</p>
  </div>
</body>
</html>`;
}
