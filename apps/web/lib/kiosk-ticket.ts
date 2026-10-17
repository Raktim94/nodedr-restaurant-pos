// Builds the customer's order ticket as a self-contained HTML document laid
// out for 80 mm thermal paper (@page size 80mm auto, zero margin, 72 mm
// printable column). Pure string building so it is unit-testable; printing
// itself (iframe + window.print) lives in kiosk-print.tsx. This is a plain
// browser/print-dialog path: nothing here talks to a printer directly.

export interface TicketData {
  restaurantName: string;
  orderNumber: string;
  createdAt: string;
  serviceLabel: string;
  items: { name: string; quantity: number; lineTotal: string }[];
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  taxLabel: string;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  locale: string;
  currency: string;
  /** Pre-rendered <svg> for the order QR (optional). */
  qrSvg?: string;
  labels: {
    order: string;
    total: string;
    taxIncluded: string;
    notPaid: string;
    payAtCounter: string;
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildTicketHtml(t: TicketData): string {
  const money = (v: string) =>
    new Intl.NumberFormat(t.locale, { style: "currency", currency: t.currency }).format(Number(v));
  const date = new Intl.DateTimeFormat(t.locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(t.createdAt),
  );
  const rows = t.items
    .map(
      (i) =>
        `<tr><td class="q">${i.quantity}×</td><td>${escapeHtml(i.name)}</td><td class="r">${escapeHtml(money(i.lineTotal))}</td></tr>`,
    )
    .join("");
  const taxRow =
    Number(t.taxAmount) > 0
      ? `<div class="row small"><span>${escapeHtml(
          t.taxMode === "INCLUSIVE" ? `${t.labels.taxIncluded} ${t.taxLabel}` : t.taxLabel,
        )}</span><span>${escapeHtml(money(t.taxAmount))}</span></div>`
      : "";
  return `<!doctype html><html lang="${escapeHtml(t.locale.slice(0, 2))}"><head><meta charset="utf-8">
<title>${escapeHtml(t.labels.order)} ${escapeHtml(t.orderNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: 80mm; margin: 0; padding: 0; background: #fff; color: #000; }
  body { padding: 4mm; font: 13px/1.35 -apple-system, Roboto, Arial, sans-serif; }
  h1 { font-size: 16px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; }
  .num { font-size: 30px; font-weight: 700; text-align: center; letter-spacing: 1px; margin: 6px 0; }
  .small { font-size: 11px; color: #333; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  td.q { width: 9mm; white-space: nowrap; }
  td.r { text-align: right; white-space: nowrap; padding-left: 4px; }
  .row { display: flex; justify-content: space-between; }
  .total { font-size: 16px; font-weight: 700; }
  .qr { text-align: center; margin-top: 6px; }
  .qr svg { width: 34mm; height: 34mm; }
  .warn { text-align: center; font-weight: 700; margin-top: 6px; }
</style></head><body>
<h1>${escapeHtml(t.restaurantName)}</h1>
<div class="c small">${escapeHtml(date)} · ${escapeHtml(t.serviceLabel)}</div>
<div class="num">${escapeHtml(t.labels.order)} ${escapeHtml(t.orderNumber)}</div>
<hr>
<table>${rows}</table>
<hr>
${taxRow}
<div class="row total"><span>${escapeHtml(t.labels.total)}</span><span>${escapeHtml(money(t.totalAmount))}</span></div>
<hr>
<div class="warn">${escapeHtml(t.labels.notPaid)}</div>
<div class="c small">${escapeHtml(t.labels.payAtCounter)}</div>
${t.qrSvg ? `<div class="qr">${t.qrSvg}</div>` : ""}
</body></html>`;
}
