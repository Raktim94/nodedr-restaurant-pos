// Lines of a sale taken on the phone, matched against the server's menu. Pure functions (no database), unit tested.
//
// A dish can appear on one bill more than once: plain, as a half portion, or with different add-ons. Each of those is
// its own line; lines with the same dish, portion and add-ons are the same thing and are merged.

export interface PhoneLine {
  menuItemId: string;
  quantity: number;
  unitPrice: number;
  modifierIds: string[];
  portion?: 'HALF' | 'FULL';
  note?: string;
}

export interface MergedLine extends PhoneLine {
  key: string;
}

export class LineConflict extends Error {}

/** Dish + portion + add-ons, the same however the add-ons were ordered. */
export function lineKey(l: {
  menuItemId: string;
  portion?: string | null;
  modifierIds: string[];
}): string {
  return `${l.menuItemId}|${l.portion ?? ''}|${[...l.modifierIds].sort().join(',')}`;
}

/** Merge repeated lines. The same dish+portion+add-ons at two different prices in one sale is a conflict. */
export function mergeLines(items: PhoneLine[]): MergedLine[] {
  const out = new Map<string, MergedLine>();
  for (const l of items) {
    const key = lineKey(l);
    const prev = out.get(key);
    if (prev && Math.abs(prev.unitPrice - l.unitPrice) > 0.005) {
      throw new LineConflict(
        'The same dish was sold at two different prices in one sale.',
      );
    }
    const notes = [prev?.note, l.note].filter(
      (n, i, a): n is string => !!n && a.indexOf(n) === i,
    );
    out.set(key, {
      key,
      menuItemId: l.menuItemId,
      quantity: (prev?.quantity ?? 0) + l.quantity,
      unitPrice: l.unitPrice,
      modifierIds: [...l.modifierIds].sort(),
      ...(l.portion ? { portion: l.portion } : {}),
      ...(notes.length ? { note: notes.join('; ').slice(0, 200) } : {}),
    });
  }
  return [...out.values()];
}

export interface MenuFacts {
  name: string;
  price: number;
  halfPrice: number | null;
  isActive: boolean;
  /** Modifier groups linked to this dish. */
  groupIds: Set<string>;
}

export interface ModifierFacts {
  name: string;
  priceAdjustment: number;
  isActive: boolean;
  groupId: string;
}

export type LineCheck =
  | { ok: true; menuPrice: number; label: string }
  | { ok: false; reason: string };

/**
 * What the server's menu says one of this line costs today (portion + add-ons, in the menu's own terms), or why the
 * line cannot be sold any more (dish off, no half portion, an add-on removed or not offered for this dish).
 */
export function checkLine(
  l: MergedLine,
  menu: Map<string, MenuFacts>,
  modifiers: Map<string, ModifierFacts>,
): LineCheck {
  const dish = menu.get(l.menuItemId);
  if (!dish || !dish.isActive) {
    return {
      ok: false,
      reason: dish?.name ?? 'a dish that no longer exists',
    };
  }
  let base = dish.price;
  if (l.portion === 'HALF') {
    if (dish.halfPrice == null)
      return { ok: false, reason: `${dish.name} (half portion)` };
    base = dish.halfPrice;
  }
  let adds = 0;
  const names: string[] = [];
  for (const id of l.modifierIds) {
    const m = modifiers.get(id);
    if (!m || !m.isActive || !dish.groupIds.has(m.groupId)) {
      return {
        ok: false,
        reason: `${m ? m.name : 'an add-on'} on ${dish.name}`,
      };
    }
    adds += m.priceAdjustment;
    names.push(m.name);
  }
  const label = `${dish.name}${l.portion === 'HALF' ? ' (Half)' : l.portion === 'FULL' ? ' (Full)' : ''}${names.length ? ` + ${names.join(', ')}` : ''}`;
  return {
    ok: true,
    menuPrice: Math.round((base + adds) * 100) / 100,
    label,
  };
}

/** Digits only, keeping a leading + (so "98765 43210" and "9876543210" are one customer). */
export function normalisePhone(raw: string): string {
  const t = raw.trim();
  const digits = t.replace(/\D/g, '');
  return t.startsWith('+') ? `+${digits}` : digits;
}
