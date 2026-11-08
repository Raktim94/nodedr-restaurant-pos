// Kitchen order tickets (KOT): what the kitchen prints and shows.
import { Writer, columnsFor } from './receipt.js';

/**
 * kot: { number, at, type, tableLabel, orderNumber, add:[{name,qty,note}], cancel:[...], reprint }
 */
export function escposKot(kot, snap) {
  const w = new Writer(columnsFor(snap));
  w.text(`KOT ${kot.number}`, { align: 1, bold: true, big: true });
  w.text(kot.type === 'DINE_IN' ? (kot.tableLabel ? `DINE IN - ${kot.tableLabel}` : 'DINE IN') : 'TAKEAWAY', { align: 1, bold: true, big: true });
  w.row(new Date(kot.at).toLocaleTimeString(), kot.orderNumber || '');
  if (kot.reprint) w.text('*** REPRINT - may be a duplicate ***', { align: 1, bold: true });
  w.rule();
  for (const l of kot.add) {
    w.text(`${l.qty} x ${l.name}`, { bold: true, big: true });
    if (l.note) w.text(`  >> ${l.note}`, { bold: true });
  }
  if (kot.cancel.length) {
    w.rule();
    w.text('CANCELLED - do not make', { bold: true, align: 1 });
    for (const l of kot.cancel) w.text(`${l.qty} x ${l.name}`, { bold: true });
  }
  w.rule();
  return w.finish();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The same ticket as a page for Android's print dialog / Save as PDF. */
export function htmlKot(kot) {
  return `<!doctype html><meta charset="utf-8"><title>KOT ${esc(kot.number)}</title>
<style>body{font:18px system-ui;margin:12px;max-width:380px}h1{margin:0;font-size:28px}.r{border:2px dashed #000;padding:4px;font-weight:700}li{margin:6px 0;font-weight:700}small{font-weight:400}</style>
<h1>KOT ${esc(kot.number)}</h1><h2>${kot.type === 'DINE_IN' ? `Dine in ${esc(kot.tableLabel || '')}` : 'Takeaway'}</h2>
<p>${esc(new Date(kot.at).toLocaleString())} ${esc(kot.orderNumber || '')}</p>${kot.reprint ? '<p class="r">REPRINT - may be a duplicate</p>' : ''}
<ul>${kot.add.map((l) => `<li>${l.qty} &times; ${esc(l.name)}${l.note ? `<br><small>&gt;&gt; ${esc(l.note)}</small>` : ''}</li>`).join('')}</ul>
${kot.cancel.length ? `<p class="r">CANCELLED - do not make</p><ul>${kot.cancel.map((l) => `<li>${l.qty} &times; ${esc(l.name)}</li>`).join('')}</ul>` : ''}`;
}
