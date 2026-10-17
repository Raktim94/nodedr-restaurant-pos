// Normalizes what a USB-HID "keyboard wedge" barcode/QR scanner types into a
// field. A wedge scanner is just a keyboard that types the payload and then
// Enter, so everything arrives as plain text, possibly with a stray prefix,
// suffix or whitespace. Only formats this app actually produces are
// recognised; anything else is rejected rather than guessed at.
//
// Known formats:
//   - order ticket QR (printed on the kiosk ticket):  orderrestro:order:<orderNumber>
//   - a bare order number typed/scanned as text:      20261017-0001   or  TA-DEMO-0001
//   - the table QR URL:                               https://host/order/<32-hex qrToken>

export type ScanResult =
  | { kind: "order"; orderNumber: string }
  | { kind: "table"; qrToken: string }
  | { kind: "invalid"; reason: "empty" | "unrecognized" };

export const ORDER_QR_PREFIX = "orderrestro:order:";
const ORDER_NUMBER = /^[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,12}){1,3}$/;
const TABLE_URL = /\/order\/([a-f0-9]{32})\/?$/i;

export function orderQrPayload(orderNumber: string): string {
  return `${ORDER_QR_PREFIX}${orderNumber}`;
}

export function normalizeScan(raw: string): ScanResult {
  // Strip control characters a scanner may add (CR/LF/TAB/STX/ETX) and trim.
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text) return { kind: "invalid", reason: "empty" };
  if (text.length > 200) return { kind: "invalid", reason: "unrecognized" };

  if (text.toLowerCase().startsWith(ORDER_QR_PREFIX)) {
    const number = text.slice(ORDER_QR_PREFIX.length).trim().toUpperCase();
    return ORDER_NUMBER.test(number)
      ? { kind: "order", orderNumber: number }
      : { kind: "invalid", reason: "unrecognized" };
  }

  const table = TABLE_URL.exec(text);
  if (table) return { kind: "table", qrToken: table[1].toLowerCase() };

  const asNumber = text.toUpperCase();
  if (ORDER_NUMBER.test(asNumber)) return { kind: "order", orderNumber: asNumber };

  return { kind: "invalid", reason: "unrecognized" };
}
