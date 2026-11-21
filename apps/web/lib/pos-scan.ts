// Barcode scanning at the POS. A USB "keyboard wedge" scanner types the code
// as fast keystrokes and finishes with Enter, so the page has to (a) collect
// that burst and (b) match it against the codes registered on menu items.
//
// A code can be registered three ways, all matched here: the menu item's own
// barcode, its SKU, or the "SKU / barcode" of the stock ingredient it
// deducts from (what Inventory > Add ingredient saves).

export interface ScannableItem {
  isActive?: boolean;
  barcode?: string | null;
  sku?: string | null;
  stockIngredient?: { sku: string | null } | null;
}

const clean = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().toLowerCase();

export function findItemByCode<T extends ScannableItem>(items: readonly T[] | undefined, raw: string): T | undefined {
  const code = clean(raw);
  if (!code || !items) return undefined;
  const hit = (v: string | null | undefined) => !!v && clean(v) === code;
  return items.find((i) => i.isActive !== false && (hit(i.barcode) || hit(i.sku) || hit(i.stockIngredient?.sku)));
}

// Gap between keystrokes above which we assume a human is typing, not a scanner.
export const SCAN_MAX_GAP_MS = 80;
export const SCAN_MIN_LENGTH = 3;

export interface ScanBuffer {
  text: string;
  last: number;
}

// Feed one key event; returns the finished code when Enter ends a scanner burst.
export function pushKey(buf: ScanBuffer, key: string, now: number): { buf: ScanBuffer; code?: string } {
  if (key === "Enter") {
    const code = buf.text.length >= SCAN_MIN_LENGTH ? buf.text : undefined;
    return { buf: { text: "", last: 0 }, code };
  }
  if (key.length !== 1) return { buf };
  const fresh = buf.last === 0 || now - buf.last > SCAN_MAX_GAP_MS;
  return { buf: { text: (fresh ? "" : buf.text) + key, last: now } };
}
