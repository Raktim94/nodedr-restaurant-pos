import {
  gstinChecksumOk,
  parseAmount,
  parseDate,
  parseInvoiceText,
} from './invoice-text';

const SAMPLE = `Fresh Farms Traders Pvt Ltd
GSTIN: 27AAPFU0939F1ZV
TAX INVOICE
Invoice No: FF/2026/0457
Invoice Date: 03/11/2026
Due Date: 18-11-2026
Paneer 10 kg   4,200.00
CGST @2.5%  105.00
SGST @2.5%  105.00
Grand Total: ₹ 1,24,410.50`;

describe('parseDate', () => {
  it.each([
    ['03/11/2026', '2026-11-03'],
    ['3-11-26', '2026-11-03'],
    ['2026-11-03', '2026-11-03'],
    ['3 Nov 2026', '2026-11-03'],
    ['3rd November, 2026', '2026-11-03'],
    ['Nov 3, 2026', '2026-11-03'],
  ])('%s', (i, o) => expect(parseDate(i)).toBe(o));
  it('rejects impossible dates', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('handles lakh grouping, symbols and decimals', () => {
    expect(parseAmount('₹ 1,24,410.50')).toBe(124410.5);
    expect(parseAmount('Rs.250/-')).toBe(250);
  });
  it('rejects junk and non-positive', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
  });
});

describe('gstinChecksumOk', () => {
  it('accepts a valid GSTIN and rejects a corrupted one', () => {
    expect(gstinChecksumOk('27AAPFU0939F1ZV')).toBe(true);
    expect(gstinChecksumOk('27AAPFU0939F1ZX')).toBe(false);
    expect(gstinChecksumOk('short')).toBe(false);
  });
});

describe('parseInvoiceText', () => {
  it('extracts all header fields from a typical Indian invoice', () => {
    const r = parseInvoiceText(SAMPLE);
    expect(r.invoiceNumber).toBe('FF/2026/0457');
    expect(r.invoiceDate).toBe('2026-11-03');
    expect(r.dueDate).toBe('2026-11-18');
    expect(r.gstin).toBe('27AAPFU0939F1ZV');
    expect(r.gstinValid).toBe(true);
    expect(r.taxAmount).toBe(210);
    expect(r.totalAmount).toBe(124410.5);
    expect(r.supplierName).toBe('Fresh Farms Traders Pvt Ltd');
    expect(r.requiresReview).toBe(false);
    expect(r.confidence).toBe(1);
  });
  it('handles CRLF line endings', () => {
    expect(parseInvoiceText(SAMPLE.replace(/\n/g, '\r\n')).invoiceNumber).toBe(
      'FF/2026/0457',
    );
  });
  it('flags missing fields for human review instead of guessing', () => {
    const r = parseInvoiceText('some random text with no invoice data');
    expect(r.invoiceNumber).toBeNull();
    expect(r.totalAmount).toBeNull();
    expect(r.requiresReview).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('flags a bad GSTIN checksum', () => {
    const r = parseInvoiceText(
      SAMPLE.replace('27AAPFU0939F1ZV', '27AAPFU0939F1ZX'),
    );
    expect(r.gstinValid).toBe(false);
    expect(r.requiresReview).toBe(true);
  });
  it('does not take the due date as the invoice date', () => {
    const r = parseInvoiceText(
      'Invoice No: A1\nDue Date: 01/12/2026\nDate: 02/11/2026\nTotal: 100',
    );
    expect(r.invoiceDate).toBe('2026-11-02');
  });
  it('survives huge or hostile input quickly', () => {
    const t0 = Date.now();
    parseInvoiceText(
      'Invoice No: ' + '9'.repeat(100_000) + '\n' + 'total '.repeat(5_000),
    );
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
