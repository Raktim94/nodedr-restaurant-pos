// Adding many tables in one go: "T" starting at 1, 10 tables -> T1 ... T10.

export const MAX_TABLES_AT_ONCE = 100;

/** The table names a bulk add would create, or throws a plain-language error. Nothing is created here. */
export function planTables({ existing = [], prefix = 'T', from = 1, count = 1 } = {}) {
  prefix = String(prefix ?? '').trim().slice(0, 12);
  from = Number(from);
  count = Number(count);
  if (!Number.isInteger(from) || from < 0 || from > 9999) throw new Error('Start number must be a whole number, for example 1.');
  if (!Number.isInteger(count) || count < 1 || count > MAX_TABLES_AT_ONCE) throw new Error(`How many must be a whole number from 1 to ${MAX_TABLES_AT_ONCE}.`);
  const taken = new Set(existing.map((l) => String(l).trim().toLowerCase()));
  const labels = Array.from({ length: count }, (_, i) => `${prefix}${from + i}`);
  const clash = labels.find((l) => taken.has(l.toLowerCase()));
  if (clash) throw new Error(`A table named ${clash} already exists. Change the start number or the name.`);
  return labels;
}
