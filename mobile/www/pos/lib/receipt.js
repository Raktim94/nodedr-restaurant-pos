// Bills and receipts built on the phone, so they print with no connection:
//   escposReceipt  -> bytes for a Bluetooth thermal printer (58 / 80 mm)
//   htmlReceipt    -> a page for Android's print dialog / Save as PDF
// Both show the same figures. An unpaid bill ("provisional") carries the UPI
// "scan to pay" QR when the restaurant has a UPI id.

const money = (n) => Number(n).toFixed(2);
const METHOD = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', OTHER: 'Other' };

export const upiPayLine = (snap) => (snap.restaurant.upiVpa ? snap.restaurant.upiVpa : null);

// ---------------------------------------------------------------- ESC/POS ---
const ESC = 0x1b;
const GS = 0x1d;

class Writer {
  constructor(columns) {
    this.cols = columns;
    this.bytes = [ESC, 0x40]; // initialise
  }
  raw(...b) {
    this.bytes.push(...b);
    return this;
  }
  ascii(s) {
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      this.bytes.push(c >= 32 && c < 127 ? c : 0x3f); // printers differ per code page; plain ASCII is safe everywhere
    }
    return this;
  }
  align(n) {
    return this.raw(ESC, 0x61, n);
  }
  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  big(on) {
    return this.raw(GS, 0x21, on ? 0x11 : 0);
  }
  nl(n = 1) {
    for (let i = 0; i < n; i++) this.bytes.push(0x0a);
    return this;
  }
  text(s, { align = 0, bold = false, big = false } = {}) {
    this.align(align).bold(bold).big(big);
    const width = big ? Math.floor(this.cols / 2) : this.cols;
    for (const line of wrap(String(s), width)) this.ascii(line).nl();
    return this.big(false).bold(false).align(0);
  }
  row(left, right, { bold = false } = {}) {
    this.bold(bold);
    const l = String(left);
    const r = String(right);
    const gap = this.cols - l.length - r.length;
    if (gap >= 1) this.ascii(l + ' '.repeat(gap) + r).nl();
    else {
      for (const line of wrap(l, this.cols)) this.ascii(line).nl();
      this.ascii(' '.repeat(Math.max(this.cols - r.length, 0)) + r).nl();
    }
    return this.bold(false);
  }
  rule() {
    return this.ascii('-'.repeat(this.cols)).nl();
  }
  qr(data, size = 6) {
    const b = new TextEncoder().encode(data);
    const n = b.length + 3;
    this.align(1);
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // model 2
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size); // module size
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // error correction M
    this.raw(GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...b); // store
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // print
    this.nl();
    return this.align(0);
  }
  finish() {
    this.nl(3).raw(GS, 0x56, 0x42, 0x00); // feed and partial cut
    return Uint8Array.from(this.bytes);
  }
}

function wrap(s, width) {
  const out = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    if (!word) continue;
    if ((line ? line.length + 1 : 0) + word.length <= width) line = line ? `${line} ${word}` : word;
    else {
      if (line) out.push(line);
      let w = word;
      while (w.length > width) {
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

export function columnsFor(snap) {
  return snap.branch.printerColumns || (snap.branch.printerPaperWidthMm >= 80 ? 48 : 32);
}

export function escposReceipt(sale, snap, { provisional = false, upiUri = null } = {}) {
  const w = new Writer(columnsFor(snap));
  w.text(snap.restaurant.name, { align: 1, bold: true, big: true });
  w.text(snap.branch.name, { align: 1 });
  if (snap.branch.address) w.text(snap.branch.address, { align: 1 });
  if (snap.branch.phone) w.text(`Tel ${snap.branch.phone}`, { align: 1 });
  if (snap.branch.gstNumber) w.text(`GSTIN ${snap.branch.gstNumber}`, { align: 1 });
  w.rule();
  w.row(new Date(sale.soldAt).toLocaleString(), '');
  w.row(`Bill ${sale.localNumber}`, sale.type === 'DINE_IN' ? 'DINE IN' : 'TAKEAWAY');
  if (sale.tableLabel) w.row(sale.tableLabel, '');
  w.rule();
  for (const it of sale.items) {
    w.row(`${it.quantity} x ${it.name}`, money(it.price * it.quantity));
  }
  w.rule();
  w.row('Subtotal', money(sale.bill.subtotal));
  if (sale.bill.discountAmount > 0) w.row('Discount', `-${money(sale.bill.discountAmount)}`);
  if (sale.bill.tax > 0) w.row(`${snap.branch.taxLabel || 'Tax'} (incl.)`, money(sale.bill.tax));
  w.row(provisional ? 'TOTAL DUE' : 'TOTAL', money(sale.bill.total), { bold: true });
  if (!provisional) {
    w.rule();
    for (const p of sale.payments) w.row(`Paid (${METHOD[p.method] || p.method})`, money(p.amount));
    if (sale.change > 0) w.row('Change', money(sale.change));
  }
  if (provisional && upiUri) {
    w.rule();
    w.text('Scan to pay by UPI', { align: 1, bold: true });
    w.qr(upiUri);
    w.text(`Amount: Rs ${money(sale.bill.total)}`, { align: 1, bold: true });
    if (snap.restaurant.upiPayeeName) w.text(snap.restaurant.upiPayeeName, { align: 1 });
  }
  w.rule();
  w.text(provisional ? 'Bill only - not a receipt. Payment pending.' : 'Thank you! Visit again.', { align: 1 });
  return w.finish();
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------- HTML ---
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function htmlReceipt(sale, snap, { provisional = false, upiSvg = null } = {}) {
  const cur = snap.restaurant.currency === 'INR' ? '₹' : `${snap.restaurant.currency} `;
  const m = (n) => `${cur}${money(n)}`;
  const rows = sale.items
    .map(
      (it) =>
        `<tr><td>${esc(it.name)}</td><td class="n">${it.quantity}</td><td class="n">${m(it.price)}</td><td class="n">${m(it.price * it.quantity)}</td></tr>`,
    )
    .join('');
  const pay = provisional
    ? ''
    : `<hr>${sale.payments.map((p) => `<div class="r"><span>Paid (${esc(METHOD[p.method] || p.method)})</span><span>${m(p.amount)}</span></div>`).join('')}${
        sale.change > 0 ? `<div class="r"><span>Change</span><span>${m(sale.change)}</span></div>` : ''
      }`;
  const upi =
    provisional && upiSvg
      ? `<hr><div class="c"><strong>Scan to pay by UPI</strong><div class="qr">${upiSvg}</div><strong>Amount: ${esc(cur)}${money(sale.bill.total)}</strong><div>${esc(snap.restaurant.upiPayeeName || '')}</div></div>`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
@page{size:80mm auto;margin:4mm}
body{font:12px/1.35 system-ui,Arial,sans-serif;color:#000;margin:0;padding:0 2mm;width:72mm}
h1{font-size:16px;margin:0;text-align:center}.c{text-align:center}.s{font-size:11px;text-align:center;margin:1px 0}
hr{border:0;border-top:1px dashed #000;margin:6px 0}table{width:100%;border-collapse:collapse}
th{font-size:10px;text-align:left;border-bottom:1px solid #000}td{padding:2px 0;vertical-align:top}.n{text-align:right}
.r{display:flex;justify-content:space-between}.t{font-weight:700;font-size:14px}.qr svg{width:35mm;height:35mm}
</style></head><body>
<h1>${esc(snap.restaurant.name)}</h1><div class="s">${esc(snap.branch.name)}</div>
${snap.branch.address ? `<div class="s">${esc(snap.branch.address)}</div>` : ''}
${snap.branch.phone ? `<div class="s">Tel ${esc(snap.branch.phone)}</div>` : ''}
${snap.branch.gstNumber ? `<div class="s">GSTIN ${esc(snap.branch.gstNumber)}</div>` : ''}
<hr><div class="r"><span>${esc(new Date(sale.soldAt).toLocaleString())}</span></div>
<div class="r"><span>Bill ${esc(sale.localNumber)}</span><span>${sale.type === 'DINE_IN' ? 'DINE IN' : 'TAKEAWAY'}</span></div>
${sale.tableLabel ? `<div>${esc(sale.tableLabel)}</div>` : ''}
<hr><table><tr><th>ITEM</th><th class="n">QTY</th><th class="n">RATE</th><th class="n">AMOUNT</th></tr>${rows}</table><hr>
<div class="r"><span>Subtotal</span><span>${m(sale.bill.subtotal)}</span></div>
${sale.bill.discountAmount > 0 ? `<div class="r"><span>Discount</span><span>-${m(sale.bill.discountAmount)}</span></div>` : ''}
${sale.bill.tax > 0 ? `<div class="r"><span>${esc(snap.branch.taxLabel || 'Tax')} (incl.)</span><span>${m(sale.bill.tax)}</span></div>` : ''}
<div class="r t"><span>${provisional ? 'TOTAL DUE' : 'TOTAL'}</span><span>${m(sale.bill.total)}</span></div>
${pay}${upi}
<hr><div class="c">${provisional ? 'Bill only &mdash; not a receipt. Payment pending.' : 'Thank you! Visit again.'}</div>
</body></html>`;
}
