import {
  headerKey,
  parseBool,
  parseEnum,
  parseList,
  parseNumber,
  parseText,
  parseTime,
} from './fields';
import type { ParsedCsv } from './csv';

export const SPICE_LEVELS = [
  'NONE',
  'MILD',
  'MEDIUM',
  'HOT',
  'EXTRA_HOT',
] as const;
export type SpiceLevelValue = (typeof SPICE_LEVELS)[number];

/** Canonical column -> accepted header spellings (compared after headerKey()). */
export const MENU_COLUMNS = {
  name: ['name', 'item', 'itemname', 'dish', 'product'],
  category: ['category', 'categoryname', 'group'],
  price: ['price', 'sellingprice', 'mrp', 'fullprice', 'rate'],
  halfPrice: ['halfprice', 'half'],
  taxRatePercent: [
    'taxratepercent',
    'taxrate',
    'tax',
    'gst',
    'gstpercent',
    'gstrate',
    'taxpercent',
  ],
  sku: ['sku', 'code', 'itemcode'],
  description: ['description', 'desc'],
  station: ['station', 'kitchenstation', 'kitchen'],
  isVeg: ['isveg', 'veg', 'vegetarian', 'foodtype'],
  spiceLevel: ['spicelevel', 'spice'],
  prepTimeMinutes: ['preptimeminutes', 'preptime', 'preparationtime'],
  costPrice: ['costprice', 'cost'],
  calories: ['calories', 'kcal'],
  allergens: ['allergens', 'allergen'],
  availableFrom: ['availablefrom', 'from'],
  availableTo: ['availableto', 'to'],
  isActive: ['isactive', 'active', 'status'],
} as const;
export type MenuColumn = keyof typeof MENU_COLUMNS;
export const MENU_REQUIRED: MenuColumn[] = ['name', 'category', 'price'];

export interface MenuRow {
  line: number;
  name: string;
  category: string;
  price: number;
  /** Optional fields: undefined means "blank in the file" - left unchanged on update, defaulted on create. */
  halfPrice?: number;
  taxRatePercent?: number;
  sku?: string;
  description?: string;
  station?: string;
  isVeg?: boolean;
  spiceLevel?: SpiceLevelValue;
  prepTimeMinutes?: number;
  costPrice?: number;
  calories?: number;
  allergens?: string[];
  availableFrom?: string;
  availableTo?: string;
  isActive?: boolean;
}

export interface RowIssue {
  line: number;
  name: string;
  messages: string[];
}

export interface ValidatedImport<T> {
  rows: T[];
  errors: RowIssue[];
  unknownColumns: string[];
  /** The file cannot be imported at all (e.g. a required column is missing). */
  fatal?: string;
}

export function mapHeaders(
  headers: string[],
  columns: Record<string, readonly string[]>,
): { index: Record<string, number>; unknown: string[] } {
  const index: Record<string, number> = {};
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    if (h === '') return;
    const key = headerKey(h);
    const col = Object.keys(columns).find((c) => columns[c].includes(key));
    if (col && index[col] === undefined) index[col] = i;
    else if (!col) unknown.push(h);
  });
  return { index, unknown };
}

export const MAX_IMPORT_ROWS = 2000;

/** Duplicate detection key, shared with the planner so both agree on identity. */
export const menuKey = (r: Pick<MenuRow, 'name' | 'category' | 'sku'>) =>
  r.sku
    ? `sku:${r.sku.toLowerCase()}`
    : `name:${r.name.toLowerCase()}|${r.category.toLowerCase()}`;

export function validateMenu(csv: ParsedCsv): ValidatedImport<MenuRow> {
  const { index, unknown } = mapHeaders(csv.headers, MENU_COLUMNS);
  const missing = MENU_REQUIRED.filter((c) => index[c] === undefined);
  if (missing.length) {
    return {
      rows: [],
      errors: [],
      unknownColumns: unknown,
      fatal: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the example file to see the expected columns.`,
    };
  }
  if (csv.rows.length === 0) {
    return {
      rows: [],
      errors: [],
      unknownColumns: unknown,
      fatal: 'The file has a header but no items',
    };
  }
  if (csv.rows.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [],
      unknownColumns: unknown,
      fatal: `The file has ${csv.rows.length} rows; the limit is ${MAX_IMPORT_ROWS} per import. Split it into smaller files.`,
    };
  }

  const rows: MenuRow[] = [];
  const errors: RowIssue[] = [];
  const seen = new Map<string, number>();

  for (const { line, cells, overflow, longer } of csv.rows) {
    if (overflow) {
      const extra = `This row has more values than the file has columns - a value that contains a comma must be wrapped in "quotes"`;
      errors.push({ line, name: cells[0] ?? '', messages: [extra] });
      continue;
    }
    const cell = (c: MenuColumn) =>
      index[c] === undefined ? '' : (cells[index[c]] ?? '');
    const msgs: string[] = [];
    const take = <T>(
      r: { ok: true; value: T } | { ok: false; error: string },
    ): T | undefined => {
      if (r.ok) return r.value;
      msgs.push(r.error);
      return undefined;
    };

    const name = take(parseText(cell('name'), 'Name', 120));
    if (!name && !msgs.length) msgs.push('Name is required');
    const category = take(parseText(cell('category'), 'Category', 60));
    if (!category && !msgs.some((m) => m.startsWith('Category')))
      msgs.push('Category is required');
    const price = take(
      parseNumber(cell('price'), 'Price', { min: 0, max: 1_000_000 }),
    );
    if (price === undefined && !msgs.some((m) => m.startsWith('Price')))
      msgs.push('Price is required');

    const row: MenuRow = {
      line,
      name: name ?? '',
      category: category ?? '',
      price: price ?? 0,
      halfPrice: take(
        parseNumber(cell('halfPrice'), 'Half price', {
          min: 0,
          max: 1_000_000,
        }),
      ),
      taxRatePercent: take(
        parseNumber(cell('taxRatePercent'), 'Tax rate', { min: 0, max: 100 }),
      ),
      sku: take(parseText(cell('sku'), 'SKU', 40)),
      description: take(parseText(cell('description'), 'Description', 500)),
      station: take(parseText(cell('station'), 'Station', 60)),
      isVeg: take(parseBool(cell('isVeg'), 'Veg')),
      spiceLevel: take(
        parseEnum(cell('spiceLevel'), 'Spice level', SPICE_LEVELS, {
          'no spice': 'NONE',
          low: 'MILD',
          med: 'MEDIUM',
          spicy: 'HOT',
          'very hot': 'EXTRA_HOT',
        }),
      ),
      prepTimeMinutes: take(
        parseNumber(cell('prepTimeMinutes'), 'Prep time', {
          min: 0,
          max: 1440,
          integer: true,
        }),
      ),
      costPrice: take(
        parseNumber(cell('costPrice'), 'Cost price', {
          min: 0,
          max: 1_000_000,
        }),
      ),
      calories: take(
        parseNumber(cell('calories'), 'Calories', {
          min: 0,
          max: 10_000,
          integer: true,
        }),
      ),
      allergens: take(parseList(cell('allergens'), 'Allergens')),
      availableFrom: take(parseTime(cell('availableFrom'), 'Available from')),
      availableTo: take(parseTime(cell('availableTo'), 'Available to')),
      isActive: take(parseBool(cell('isActive'), 'Active')),
    };
    if (
      row.halfPrice !== undefined &&
      price !== undefined &&
      row.halfPrice > price
    ) {
      msgs.push('Half price is higher than the full price');
    }
    if ((row.availableFrom === undefined) !== (row.availableTo === undefined)) {
      msgs.push('Set both Available from and Available to, or neither');
    }

    if (msgs.length && longer) {
      msgs.push(
        'This row has more columns than the header - a value that contains a comma (such as a name or description) must be wrapped in "quotes"',
      );
    }
    if (!msgs.length) {
      const key = menuKey(row);
      const first = seen.get(key);
      if (first !== undefined)
        msgs.push(
          `Duplicate of line ${first} in this file (same ${row.sku ? 'SKU' : 'name and category'})`,
        );
      else seen.set(key, line);
    }
    if (msgs.length) errors.push({ line, name: name ?? '', messages: msgs });
    else rows.push(row);
  }
  return { rows, errors, unknownColumns: unknown };
}
