// Per-table cart drafts for the POS. Switching from Table 1 to Table 2 used to
// keep one shared cart, so items typed for Table 1 silently landed on Table 2's
// bill. Each table now keeps its own unsent cart; a cart built before any
// table was picked is carried onto the first table chosen (merged, never
// replacing a draft that table already had).
export interface DraftLine {
  key: string;
  quantity: number;
}

export type Drafts<L extends DraftLine> = Record<string, L[]>;

function merge<L extends DraftLine>(a: L[], b: L[]): L[] {
  const out = a.map((l) => ({ ...l }));
  for (const line of b) {
    const hit = out.find((l) => l.key === line.key);
    if (hit) hit.quantity += line.quantity;
    else out.push({ ...line });
  }
  return out;
}

export function switchTableDraft<L extends DraftLine>(
  drafts: Drafts<L>,
  fromTableId: string,
  toTableId: string,
  lines: L[],
): { drafts: Drafts<L>; lines: L[] } {
  if (fromTableId === toTableId) return { drafts, lines };
  const next: Drafts<L> = { ...drafts };
  if (fromTableId) {
    if (lines.length > 0) next[fromTableId] = lines;
    else delete next[fromTableId];
  }
  const stored = toTableId ? (next[toTableId] ?? []) : [];
  // No previous table = the cart was started before choosing one: keep it.
  const carried = fromTableId ? [] : lines;
  if (toTableId) delete next[toTableId];
  return { drafts: next, lines: merge(stored, carried) };
}

export function clearDraft<L extends DraftLine>(drafts: Drafts<L>, tableId: string): Drafts<L> {
  if (!(tableId in drafts)) return drafts;
  const next = { ...drafts };
  delete next[tableId];
  return next;
}
