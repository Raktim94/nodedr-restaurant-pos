// Half portions and add-ons on the phone. A dish can be on one order several times (plain, half, with cheese...):
// each of those is its own cart line, named by its key. Pure functions, unit tested.
import { round2 } from './bill.js';

/** Dish + portion + add-ons, the same however the add-ons were picked. Same scheme as the server's offline-lines.ts. */
export const lineKey = (menuItemId, portion = '', modifierIds = []) => `${menuItemId}|${portion || ''}|${[...modifierIds].sort().join(',')}`;

/** Does tapping this dish need the options sheet first? */
export const needsChoice = (item) => item.halfPrice != null || (item.options || []).length > 0;

/**
 * Check what was picked and work out the line. `picks` = { portion: 'FULL'|'HALF', chosen: { groupId: [choiceId...] } }.
 * Returns { ok: true, line } or { ok: false, errors: { groupId|'portion': message } }.
 */
export function buildChoice(item, picks) {
  const errors = {};
  const portion = item.halfPrice != null ? (picks.portion === 'HALF' ? 'HALF' : 'FULL') : '';
  const mods = [];
  for (const g of item.options || []) {
    const ids = (picks.chosen && picks.chosen[g.id]) || [];
    const valid = ids.filter((id) => g.choices.some((c) => c.id === id));
    if (valid.length < g.min) errors[g.id] = g.min === 1 ? `Choose one ${g.name.toLowerCase()}.` : `Choose at least ${g.min}.`;
    else if (valid.length > g.max) errors[g.id] = `Choose at most ${g.max}.`;
    for (const id of valid) {
      const c = g.choices.find((x) => x.id === id);
      mods.push({ id: c.id, name: c.name, price: Number(c.price) || 0 });
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const base = portion === 'HALF' ? Number(item.halfPrice) : Number(item.price);
  const price = round2(base + mods.reduce((n, m) => n + m.price, 0));
  const name = `${item.name}${portion === 'HALF' ? ' (Half)' : portion === 'FULL' ? ' (Full)' : ''}${mods.length ? ` + ${mods.map((m) => m.name).join(', ')}` : ''}`;
  return {
    ok: true,
    line: {
      key: lineKey(item.id, portion, mods.map((m) => m.id)),
      item: { id: item.id, name, price, taxRate: item.taxRate, sellOffline: true },
      portion: portion || undefined,
      mods,
    },
  };
}

/** The choices a dish starts with: Full portion and each group's default add-ons. */
export function defaultPicks(item) {
  const chosen = {};
  for (const g of item.options || []) {
    const d = g.choices.filter((c) => c.isDefault).map((c) => c.id).slice(0, g.max);
    chosen[g.id] = d.length || g.min !== 1 ? d : [];
  }
  return { portion: 'FULL', chosen };
}

/** Exact barcode or SKU match (what a scanner or a typed code gives), or null. */
export function findByCode(items, code) {
  const c = String(code || '').trim();
  if (!c) return null;
  return items.find((i) => (i.barcode && i.barcode === c) || (i.sku && i.sku.toLowerCase() === c.toLowerCase())) || null;
}
