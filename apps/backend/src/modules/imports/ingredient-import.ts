import type { ParsedCsv } from './csv';
import { parseBool, parseEnum, parseNumber, parseText } from './fields';
import {
  mapHeaders,
  MAX_IMPORT_ROWS,
  type RowIssue,
  type ValidatedImport,
} from './menu-import';

export const INGREDIENT_UNITS = [
  'KG',
  'G',
  'L',
  'ML',
  'PIECE',
  'DOZEN',
  'PACK',
  'BOX',
] as const;
export type IngredientUnitValue = (typeof INGREDIENT_UNITS)[number];

const UNIT_ALIASES: Record<string, IngredientUnitValue> = {
  kgs: 'KG',
  kilo: 'KG',
  kilogram: 'KG',
  kilograms: 'KG',
  gm: 'G',
  gms: 'G',
  gram: 'G',
  grams: 'G',
  gr: 'G',
  ltr: 'L',
  litre: 'L',
  litres: 'L',
  liter: 'L',
  liters: 'L',
  mls: 'ML',
  millilitre: 'ML',
  milliliter: 'ML',
  pc: 'PIECE',
  pcs: 'PIECE',
  piece: 'PIECE',
  pieces: 'PIECE',
  nos: 'PIECE',
  no: 'PIECE',
  unit: 'PIECE',
  units: 'PIECE',
  each: 'PIECE',
  doz: 'DOZEN',
  dozens: 'DOZEN',
  packet: 'PACK',
  packets: 'PACK',
  packs: 'PACK',
  pkt: 'PACK',
  boxes: 'BOX',
};

export const INGREDIENT_COLUMNS = {
  name: ['name', 'ingredient', 'ingredientname', 'item', 'material'],
  unit: ['unit', 'uom', 'measure', 'unitofmeasure'],
  sku: ['sku', 'code', 'itemcode'],
  reorderLevel: [
    'reorderlevel',
    'reorder',
    'minstock',
    'minimumstock',
    'lowstock',
    'lowstocklevel',
  ],
  costPerUnit: ['costperunit', 'cost', 'unitcost', 'rate', 'price'],
  openingStock: [
    'openingstock',
    'stock',
    'currentstock',
    'quantity',
    'qty',
    'opening',
  ],
  isActive: ['isactive', 'active', 'status'],
} as const;
export type IngredientColumn = keyof typeof INGREDIENT_COLUMNS;

export interface IngredientRow {
  line: number;
  name: string;
  unit: IngredientUnitValue;
  sku?: string;
  reorderLevel?: number;
  costPerUnit?: number;
  openingStock?: number;
  isActive?: boolean;
}

export const ingredientKey = (name: string) => name.toLowerCase();

export function validateIngredients(
  csv: ParsedCsv,
): ValidatedImport<IngredientRow> {
  const { index, unknown } = mapHeaders(csv.headers, INGREDIENT_COLUMNS);
  const missing = (['name', 'unit'] as IngredientColumn[]).filter(
    (c) => index[c] === undefined,
  );
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
      fatal: 'The file has a header but no ingredients',
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

  const rows: IngredientRow[] = [];
  const errors: RowIssue[] = [];
  const seen = new Map<string, number>();

  for (const { line, cells, overflow, longer } of csv.rows) {
    if (overflow) {
      const extra = `This row has more values than the file has columns - a value that contains a comma must be wrapped in "quotes"`;
      errors.push({ line, name: cells[0] ?? '', messages: [extra] });
      continue;
    }
    const cell = (c: IngredientColumn) =>
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
    const unit = take(
      parseEnum(cell('unit'), 'Unit', INGREDIENT_UNITS, UNIT_ALIASES),
    );
    if (!unit && !msgs.some((m) => m.startsWith('Unit')))
      msgs.push('Unit is required');

    const row: IngredientRow = {
      line,
      name: name ?? '',
      unit: unit ?? 'KG',
      sku: take(parseText(cell('sku'), 'SKU', 40)),
      reorderLevel: take(
        parseNumber(cell('reorderLevel'), 'Reorder level', {
          min: 0,
          max: 1e9,
        }),
      ),
      costPerUnit: take(
        parseNumber(cell('costPerUnit'), 'Cost per unit', { min: 0, max: 1e9 }),
      ),
      openingStock: take(
        parseNumber(cell('openingStock'), 'Opening stock', {
          min: 0,
          max: 1e9,
        }),
      ),
      isActive: take(parseBool(cell('isActive'), 'Active')),
    };
    if (msgs.length && longer) {
      msgs.push(
        'This row has more columns than the header - a value that contains a comma (such as a name or description) must be wrapped in "quotes"',
      );
    }
    if (!msgs.length) {
      const key = ingredientKey(row.name);
      const first = seen.get(key);
      if (first !== undefined)
        msgs.push(`Duplicate of line ${first} in this file (same name)`);
      else seen.set(key, line);
    }
    if (msgs.length) errors.push({ line, name: name ?? '', messages: msgs });
    else rows.push(row);
  }
  return { rows, errors, unknownColumns: unknown };
}
