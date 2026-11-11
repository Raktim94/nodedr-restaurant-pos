// Pure planning for "what inventory does selling these lines move?". No
// database access, so every rule is unit-testable: recipe vs direct tracking,
// untracked items, combo expansion and unmapped (misconfigured) items.

export type InventoryTrackingMode = 'NONE' | 'RECIPE' | 'DIRECT';

export interface PlanItem {
  id: string;
  name: string;
  isCombo: boolean;
  tracking: InventoryTrackingMode;
  stockIngredientId: string | null;
  stockQuantityPerSale: number;
  recipe: { ingredientId: string; quantity: number }[];
}

export interface PlanCombo {
  comboItemId: string;
  componentItemId: string;
  quantity: number;
}

export type SkipReason = 'NO_RECIPE' | 'NO_STOCK_ITEM' | 'UNKNOWN_ITEM';

export interface StockPlan {
  /** ingredientId -> total quantity (ingredient units) to move for the lines. */
  needs: Map<string, number>;
  /** Tracked items that could not be mapped to stock: surfaced, never silent. */
  skipped: { menuItemId: string; name: string; reason: SkipReason }[];
}

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * One sold line. `portionRatio` is the share of a full portion's stock the line uses (a Half
 * portion of an item with costing = its halfPortionRatio; default 1). `extras` are the signed raw
 * quantities per unit sold that the chosen options add (cheese) or remove (no onion).
 */
export interface PlanLine {
  menuItemId: string;
  quantity: number;
  portionRatio?: number;
  extras?: { ingredientId: string; quantity: number }[];
}

export function planStockUsage(
  lines: readonly PlanLine[],
  items: ReadonlyMap<string, PlanItem>,
  combos: readonly PlanCombo[],
): StockPlan {
  const componentsByCombo = new Map<string, PlanCombo[]>();
  for (const c of combos) {
    const list = componentsByCombo.get(c.comboItemId) ?? [];
    list.push(c);
    componentsByCombo.set(c.comboItemId, list);
  }

  const needs = new Map<string, number>();
  const skipped: StockPlan['skipped'] = [];
  const need = (ingredientId: string, q: number) =>
    needs.set(ingredientId, r3((needs.get(ingredientId) ?? 0) + q));

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const ratio = line.portionRatio && line.portionRatio > 0 ? line.portionRatio : 1;
    // This line's own needs. Clamped at zero per ingredient before joining the order total, so a
    // "no onion" option can never cancel the onion another line really uses.
    const own = new Map<string, number>();
    const addOwn = (ingredientId: string, q: number) =>
      own.set(ingredientId, (own.get(ingredientId) ?? 0) + q);

    const top = items.get(line.menuItemId);
    const leaves: { id: string; sold: number; ratio: number }[] = [];
    if (top?.isCombo) {
      for (const c of componentsByCombo.get(top.id) ?? []) {
        leaves.push({ id: c.componentItemId, sold: c.quantity * line.quantity, ratio: 1 });
      }
    } else {
      leaves.push({ id: line.menuItemId, sold: line.quantity, ratio });
    }

    for (const leaf of leaves) {
      const item = items.get(leaf.id);
      if (!item) {
        skipped.push({ menuItemId: leaf.id, name: leaf.id, reason: 'UNKNOWN_ITEM' });
        continue;
      }
      if (item.tracking === 'NONE') continue;
      if (item.tracking === 'DIRECT') {
        if (!item.stockIngredientId || item.stockQuantityPerSale <= 0) {
          skipped.push({ menuItemId: leaf.id, name: item.name, reason: 'NO_STOCK_ITEM' });
          continue;
        }
        addOwn(item.stockIngredientId, item.stockQuantityPerSale * leaf.sold * leaf.ratio);
        continue;
      }
      if (item.recipe.length === 0) {
        skipped.push({ menuItemId: leaf.id, name: item.name, reason: 'NO_RECIPE' });
        continue;
      }
      for (const r of item.recipe) addOwn(r.ingredientId, r.quantity * leaf.sold * leaf.ratio);
    }
    for (const e of line.extras ?? []) addOwn(e.ingredientId, e.quantity * line.quantity);

    for (const [ingredientId, q] of own) if (q > 0) need(ingredientId, q);
  }
  return { needs, skipped };
}
