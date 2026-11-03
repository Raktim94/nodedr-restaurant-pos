// Pulls the header fields out of pasted/copied supplier-invoice text so the
// "record invoice" form can be pre-filled. Pure and dependency-free: it runs
// the same on Linux, macOS, Windows, Android and iOS because it only sees a
// string. Nothing here is trusted - the caller shows the result for a human
// to confirm, and `warnings` says exactly what needs a second look.

export interface ParsedInvoice {
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  supplierName: string | null;
  gstin: string | null;
  gstinValid: boolean | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: 'INR' | null;
  confidence: number; // 0..1, share of the four key fields found
  requiresReview: boolean;
  warnings: string[];
}

export const MAX_INVOICE_TEXT = 20_000;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  return dt.toISOString().slice(0, 10);
}

/** Parses 03/11/2026, 3-11-26, 2026-11-03, 3 Nov 2026, Nov 3, 2026. India = day first. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2,4})\b/,
  );
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  }
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  }
  return null;
}

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/;
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Verifies the GSTIN check character (mod-36 Luhn variant used by GSTN). */
export function gstinChecksumOk(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(gstin[i]);
    if (v < 0) return false;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

/** "1,23,456.78", "₹ 4,500", "Rs.250/-" -> number. Null if not a sane amount. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/rs\.?|inr/gi, '')
    .replace(/[^\d.,]/g, '')
    .replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 && n < 1_000_000_000 ? n : null;
}

const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*([\d][\d,]*(?:\.\d{1,2})?)`;

function lastAmount(text: string, labels: string[]): number | null {
  let found: number | null = null;
  for (const label of labels) {
    const re = new RegExp(
      String.raw`${label}[^\S\n]*[:=-]?[^\S\n]*${AMOUNT}`,
      'gi',
    );
    for (const m of text.matchAll(re)) {
      const n = parseAmount(m[1]);
      if (n !== null) found = n;
    }
    if (found !== null) return found; // earlier label = more specific
  }
  return null;
}

export function parseInvoiceText(input: string): ParsedInvoice {
  const text = input.replace(/\r/g, '').slice(0, MAX_INVOICE_TEXT);
  const warnings: string[] = [];

  const numMatch = text.match(
    /(?:tax\s+)?(?:invoice|bill|inv)\s*(?:no\.?|number|num|#)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/_.-]{1,29})/i,
  );
  const invoiceNumber = numMatch ? numMatch[1].replace(/[.\-/]+$/, '') : null;

  let invoiceDate: string | null = null;
  for (const line of text.split('\n')) {
    if (/due|expir|valid/i.test(line)) continue;
    const m = line.match(/date\s*[:.-]?\s*(.{6,30})/i);
    if (m && (invoiceDate = parseDate(m[1]))) break;
  }
  if (!invoiceDate) {
    // Fall back to the first date anywhere that isn't labelled due/expiry.
    for (const line of text.split('\n')) {
      if (/due|expir|valid/i.test(line)) continue;
      const d = parseDate(line);
      if (d) {
        invoiceDate = d;
        break;
      }
    }
  }
  const dueMatch = text.match(
    /(?:due\s*date|payment\s*due|pay\s*by|due\s*on)\s*[:.-]?\s*([^\n]{6,30})/i,
  );
  const dueDate = dueMatch ? parseDate(dueMatch[1]) : null;

  const gm = text.toUpperCase().match(GSTIN_RE);
  const gstin = gm ? gm[1] : null;
  const gstinValid = gstin ? gstinChecksumOk(gstin) : null;
  if (gstin && !gstinValid)
    warnings.push('GSTIN found but its check character is wrong - verify it.');

  const totalAmount = lastAmount(text, [
    'grand\\s*total',
    'net\\s*payable',
    'amount\\s*payable',
    'total\\s*amount\\s*due',
    'amount\\s*due',
    'invoice\\s*total',
    'total\\s*invoice\\s*value',
    'total\\s*amount',
    'total',
  ]);
  const cgst = lastAmount(text, ['cgst(?:\\s*@?\\s*[\\d.]+%)?']);
  const sgst = lastAmount(text, [
    'sgst(?:\\s*@?\\s*[\\d.]+%)?',
    'utgst(?:\\s*@?\\s*[\\d.]+%)?',
  ]);
  const igst = lastAmount(text, ['igst(?:\\s*@?\\s*[\\d.]+%)?']);
  const taxParts = [cgst, sgst, igst].filter((v): v is number => v !== null);
  const taxAmount = taxParts.length
    ? Math.round(taxParts.reduce((a, b) => a + b, 0) * 100) / 100
    : null;

  // Supplier = first meaningful line that is not a label/number-only line.
  const supplierName =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(
        (l) =>
          l.length >= 3 &&
          l.length <= 80 &&
          /[A-Za-z]{3}/.test(l) &&
          !/invoice|bill|date|gst|total|page|original|duplicate|tax\b|^\W*$|^\d/i.test(
            l,
          ),
      ) ?? null;

  if (taxAmount !== null && totalAmount !== null && taxAmount > totalAmount) {
    warnings.push('Tax is larger than the total - check the amounts.');
  }
  if (!invoiceNumber) warnings.push('Invoice number not found.');
  if (!invoiceDate) warnings.push('Invoice date not found.');
  if (totalAmount === null) warnings.push('Total amount not found.');
  if (invoiceDate && dueDate && dueDate < invoiceDate)
    warnings.push('Due date is before the invoice date.');

  const key = [invoiceNumber, invoiceDate, totalAmount, supplierName];
  return {
    invoiceNumber,
    invoiceDate,
    dueDate,
    supplierName,
    gstin,
    gstinValid,
    taxAmount,
    totalAmount,
    currency: totalAmount !== null ? 'INR' : null,
    confidence: key.filter((v) => v !== null).length / key.length,
    requiresReview:
      !invoiceNumber ||
      !invoiceDate ||
      totalAmount === null ||
      gstinValid === false ||
      warnings.length > 0,
    warnings,
  };
}
