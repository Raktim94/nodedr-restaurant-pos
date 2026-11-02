// UPI deep link per the NPCI linking spec (same format as apps/web/lib/upi.ts).
// Scanning the QR opens any UPI app with the payee and the exact amount filled.
export function buildUpiUri(opts: {
  vpa: string;
  name?: string | null;
  amount: number;
  note?: string;
  ref?: string;
}): string {
  const q = new URLSearchParams();
  q.set('pa', opts.vpa);
  if (opts.name) q.set('pn', opts.name.slice(0, 60));
  if (opts.amount > 0) q.set('am', opts.amount.toFixed(2));
  q.set('cu', 'INR');
  if (opts.note) q.set('tn', opts.note.slice(0, 60));
  if (opts.ref) q.set('tr', opts.ref.slice(0, 35));
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

export interface ReceiptUpi {
  /** upi://pay link for the amount still due. */
  uri: string;
  amountText: string;
  payee: string | null;
}

/**
 * The "scan to pay" block for a bill that is not paid yet. Null when the
 * restaurant has no UPI id configured, when the bill is already paid, or
 * when nothing is due.
 */
export function upiForBill(opts: {
  vpa: string | null | undefined;
  payeeName: string | null | undefined;
  orderNumber: string;
  balanceDue: number;
  isProvisional: boolean;
  currencySymbol?: string;
}): ReceiptUpi | null {
  const vpa = opts.vpa?.trim();
  if (!vpa || !opts.isProvisional || !(opts.balanceDue > 0)) return null;
  return {
    uri: buildUpiUri({
      vpa,
      name: opts.payeeName,
      amount: opts.balanceDue,
      note: `Order ${opts.orderNumber}`,
      ref: opts.orderNumber,
    }),
    amountText: `${opts.currencySymbol ?? 'Rs '}${opts.balanceDue.toFixed(2)}`,
    payee: opts.payeeName?.trim() || null,
  };
}
