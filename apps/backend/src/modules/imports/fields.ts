// Cell-level parsing shared by the CSV imports. Each returns either a value or
// an error message written for the person editing the spreadsheet.
import { looksLikeFormula } from './csv';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string): Parsed<never> => ({ ok: false, error });

/** Header cell -> comparison key: "Tax Rate %" and "tax_rate_percent" both reduce to letters/digits. */
export const headerKey = (h: string) =>
  h.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseText(
  raw: string,
  label: string,
  max: number,
): Parsed<string | undefined> {
  const v = raw.trim();
  if (v === '') return ok(undefined);
  if (v.length > max) return bad(`${label} is longer than ${max} characters`);
  if (looksLikeFormula(v)) {
    return bad(
      `${label} starts with "${v[0]}", which spreadsheets treat as a formula - remove it`,
    );
  }
  return ok(v);
}

export function parseNumber(
  raw: string,
  label: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): Parsed<number | undefined> {
  let v = raw
    .trim()
    .replace(/^(?:₹|rs\.?|inr)\s*/i, '')
    .replace(/\s/g, '');
  if (v === '') return ok(undefined);
  // 1,200.50 (thousands commas) is fine; 12,5 (decimal comma) is ambiguous - refuse it.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, '');
  if (/^\d+,\d{1,2}$/.test(v)) {
    return bad(
      `${label} "${raw.trim()}" uses a decimal comma - write it with a dot (12.5)`,
    );
  }
  if (!/^-?\d+(\.\d+)?$/.test(v))
    return bad(`${label} "${raw.trim()}" is not a number`);
  const n = Number(v);
  if (!Number.isFinite(n)) return bad(`${label} is not a valid number`);
  if (opts.integer && !Number.isInteger(n))
    return bad(`${label} must be a whole number`);
  if (opts.min !== undefined && n < opts.min)
    return bad(`${label} cannot be below ${opts.min}`);
  if (opts.max !== undefined && n > opts.max)
    return bad(`${label} cannot be above ${opts.max}`);
  return ok(n);
}

const YES = new Set(['yes', 'y', 'true', 't', '1', 'veg', 'active', 'on']);
const NO = new Set([
  'no',
  'n',
  'false',
  'f',
  '0',
  'non-veg',
  'nonveg',
  'non veg',
  'inactive',
  'off',
]);

export function parseBool(
  raw: string,
  label: string,
): Parsed<boolean | undefined> {
  const v = raw.trim().toLowerCase();
  if (v === '') return ok(undefined);
  if (YES.has(v)) return ok(true);
  if (NO.has(v)) return ok(false);
  return bad(`${label} "${raw.trim()}" should be yes or no`);
}

export function parseEnum<T extends string>(
  raw: string,
  label: string,
  allowed: readonly T[],
  aliases: Record<string, T> = {},
): Parsed<T | undefined> {
  const v = raw.trim();
  if (v === '') return ok(undefined);
  const key = v.toUpperCase().replace(/[\s-]+/g, '_');
  const hit = (allowed as readonly string[]).includes(key)
    ? (key as T)
    : aliases[v.toLowerCase()];
  return hit
    ? ok(hit)
    : bad(`${label} "${v}" is not one of: ${allowed.join(', ')}`);
}

export function parseTime(
  raw: string,
  label: string,
): Parsed<string | undefined> {
  const v = raw.trim();
  if (v === '') return ok(undefined);
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    return bad(`${label} "${v}" should look like 09:30 (24-hour)`);
  }
  return ok(`${m[1].padStart(2, '0')}:${m[2]}`);
}

export function parseList(
  raw: string,
  label: string,
): Parsed<string[] | undefined> {
  const v = raw.trim();
  if (v === '') return ok(undefined);
  const items = v
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const i of items) {
    if (i.length > 40)
      return bad(`${label} entry "${i.slice(0, 20)}..." is too long`);
    if (looksLikeFormula(i))
      return bad(`${label} entry "${i}" starts with a formula character`);
  }
  return ok([...new Set(items)]);
}
