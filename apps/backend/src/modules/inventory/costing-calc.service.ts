import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  costModifierLines,
  costRecipe,
  effectiveUnitCost,
  stockNeedsForPortions,
  unitCostOfSale,
  type CostIngredient,
  type CostLineInput,
  type CostPreparation,
  type CostUnit,
  type ModifierCost,
  type Overhead,
  type RecipeCost,
  type UnitConversion,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

const n = (v: unknown): number => Number(v);

/** A menu item with everything costing needs, as loaded by loadDishContext(). */
export interface DishContext {
  id: string;
  name: string;
  isCombo: boolean;
  price: number;
  halfPrice: number | null;
  taxRatePercent: number;
  tracking: 'NONE' | 'RECIPE' | 'DIRECT';
  stockIngredientId: string | null;
  stockQuantityPerSale: number;
  recipe: CostPreparation;
  halfPortionRatio: number | null; // null = no costing row yet (legacy: a half uses a whole)
  costing: {
    version: number;
    targetMarginPercent: number | null;
    targetMarkupPercent: number | null;
    alertDropPoints: number;
    baselineCost: number | null;
  } | null;
}

export type DishCostSource = 'RECIPE' | 'STOCK_ITEM' | 'NONE';

export interface DishCost {
  costPerPortion: number | null;
  source: DishCostSource;
  /** Present for RECIPE items: the full line-by-line breakdown. */
  recipeCost: RecipeCost | null;
  /** Present for STOCK_ITEM items (bottled drinks, prepared batches). */
  stockItem: { ingredientId: string; name: string; unitCost: number | null; quantityPerSale: number; label: string } | null;
  overheadPerPortion: number;
  complete: boolean;
}

export function overheadPerPortion(overheads: readonly Overhead[], batchOutputQty: number): number {
  let total = 0;
  for (const o of overheads) {
    if (!(o.amount > 0)) continue;
    total += o.basis === 'PER_PORTION' ? o.amount : batchOutputQty > 0 ? o.amount / batchOutputQty : 0;
  }
  return total;
}

export function toCostIngredient(r: {
  id: string;
  name: string;
  unit: string;
  costPerUnit: unknown;
  costMethod: string;
  purchaseQuantity: unknown;
  purchaseUnit: string | null;
  purchasePrice: unknown;
  yieldPercent: unknown;
  conversions: unknown;
  preparation?: {
    batchOutputQty: unknown;
    overheads: unknown;
    lines: { ingredientId: string; quantity: unknown; unit: string | null }[];
  } | null;
}): CostIngredient {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit as CostUnit,
    costPerUnit: n(r.costPerUnit),
    costMethod: r.costMethod as CostIngredient['costMethod'],
    purchaseQuantity: r.purchaseQuantity == null ? null : n(r.purchaseQuantity),
    purchaseUnit: (r.purchaseUnit as CostUnit | null) ?? null,
    purchasePrice: r.purchasePrice == null ? null : n(r.purchasePrice),
    yieldPercent: n(r.yieldPercent),
    conversions: Array.isArray(r.conversions) ? (r.conversions as UnitConversion[]) : [],
    preparation: r.preparation
      ? {
          batchOutputQty: n(r.preparation.batchOutputQty),
          overheads: Array.isArray(r.preparation.overheads) ? (r.preparation.overheads as unknown as Overhead[]) : [],
          lines: r.preparation.lines.map<CostLineInput>((l) => ({
            ingredientId: l.ingredientId,
            quantity: n(l.quantity),
            unit: l.unit as CostUnit | null,
          })),
        }
      : null,
  };
}

/**
 * Loads costing data and computes dish costs. Used by checkout (stock planning and the frozen
 * unit-cost snapshot) and by the costing API, so both always agree.
 */
@Injectable()
export class CostingCalcService {
  constructor(private readonly prisma: PrismaService) {}

  async loadIngredients(db: Db, branchId: string): Promise<Map<string, CostIngredient>> {
    const rows = await db.ingredient.findMany({
      where: { branchId },
      include: { preparation: { include: { lines: true } } },
    });
    return new Map(rows.map((r) => [r.id, toCostIngredient(r)]));
  }

  async loadDishContexts(db: Db, menuItemIds: string[]): Promise<Map<string, DishContext>> {
    if (menuItemIds.length === 0) return new Map();
    const rows = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      include: { recipeLines: true, costing: true },
    });
    return new Map(
      rows.map((m) => {
        const c = m.costing;
        const ctx: DishContext = {
          id: m.id,
          name: m.name,
          isCombo: m.isCombo,
          price: n(m.price),
          halfPrice: m.halfPrice == null ? null : n(m.halfPrice),
          taxRatePercent: n(m.taxRatePercent),
          tracking: m.inventoryTracking,
          stockIngredientId: m.stockIngredientId,
          stockQuantityPerSale: n(m.stockQuantityPerSale),
          recipe: {
            batchOutputQty: c ? n(c.batchOutputQty) : 1,
            overheads: c && Array.isArray(c.overheads) ? (c.overheads as unknown as Overhead[]) : [],
            lines: m.recipeLines.map<CostLineInput>((l) => ({
              ingredientId: l.ingredientId,
              quantity: n(l.quantity),
              unit: l.unit as CostUnit | null,
            })),
          },
          halfPortionRatio: c ? n(c.halfPortionRatio) : null,
          costing: c
            ? {
                version: c.version,
                targetMarginPercent: c.targetMarginPercent == null ? null : n(c.targetMarginPercent),
                targetMarkupPercent: c.targetMarkupPercent == null ? null : n(c.targetMarkupPercent),
                alertDropPoints: n(c.alertDropPoints),
                baselineCost: c.baselineCost == null ? null : n(c.baselineCost),
              }
            : null,
        };
        return [m.id, ctx];
      }),
    );
  }

  /** Cost of one FULL portion of a dish. Combos are priced from their components by the caller. */
  dishCost(ctx: DishContext, ingredients: ReadonlyMap<string, CostIngredient>): DishCost {
    const perPortionOverhead = overheadPerPortion(ctx.recipe.overheads ?? [], ctx.recipe.batchOutputQty);
    if (ctx.tracking === 'DIRECT' && ctx.stockIngredientId) {
      const ing = ingredients.get(ctx.stockIngredientId);
      if (!ing) {
        return { costPerPortion: null, source: 'STOCK_ITEM', recipeCost: null, stockItem: null, overheadPerPortion: perPortionOverhead, complete: false };
      }
      const uc = effectiveUnitCost(ing, ingredients);
      const unitCost = uc.usablePerStockUnit;
      const cost = unitCost === null ? null : unitCost * ctx.stockQuantityPerSale + perPortionOverhead;
      return {
        costPerPortion: cost === null ? null : Math.round((cost + Number.EPSILON) * 10000) / 10000,
        source: 'STOCK_ITEM',
        recipeCost: null,
        stockItem: {
          ingredientId: ing.id,
          name: ing.name,
          unitCost,
          quantityPerSale: ctx.stockQuantityPerSale,
          label: uc.label,
        },
        overheadPerPortion: perPortionOverhead,
        complete: cost !== null,
      };
    }
    if (ctx.recipe.lines.length === 0) {
      return { costPerPortion: null, source: 'NONE', recipeCost: null, stockItem: null, overheadPerPortion: perPortionOverhead, complete: false };
    }
    const rc = costRecipe(ctx.recipe, ingredients);
    return {
      costPerPortion: rc.costPerPortion,
      source: 'RECIPE',
      recipeCost: rc,
      stockItem: null,
      overheadPerPortion: perPortionOverhead,
      complete: rc.complete,
    };
  }

  async loadModifierLines(db: Db, modifierIds: string[]) {
    if (modifierIds.length === 0) return new Map<string, { ingredientId: string; quantity: number; unit: CostUnit | null }[]>();
    const rows = await db.modifierIngredient.findMany({ where: { modifierId: { in: modifierIds } } });
    const out = new Map<string, { ingredientId: string; quantity: number; unit: CostUnit | null }[]>();
    for (const r of rows) {
      const list = out.get(r.modifierId) ?? [];
      list.push({ ingredientId: r.ingredientId, quantity: n(r.quantity), unit: r.unit as CostUnit | null });
      out.set(r.modifierId, list);
    }
    return out;
  }

  modifierCost(
    lines: { ingredientId: string; quantity: number; unit?: CostUnit | null }[] | undefined,
    ingredients: ReadonlyMap<string, CostIngredient>,
  ): ModifierCost {
    return costModifierLines(lines ?? [], ingredients);
  }

  /** Raw stock to take off the shelf for ONE full portion of a RECIPE dish (yield applied once). */
  recipeNeedsPerPortion(ctx: DishContext, ingredients: ReadonlyMap<string, CostIngredient>) {
    return stockNeedsForPortions(ctx.recipe, ingredients, 1).needs;
  }

  /**
   * Production cost of ONE unit for each sold line - frozen onto the order item at payment so a
   * later price change never rewrites history. A line's cost is null (not guessed) when anything
   * in it is unpriced.
   */
  async unitCostsForSale(
    db: Db,
    branchId: string,
    lines: { menuItemId: string; portionRatio: number; modifierIds: string[] }[],
  ): Promise<(number | null)[]> {
    const ids = [...new Set(lines.map((l) => l.menuItemId))];
    const combos = await db.comboComponent.findMany({ where: { comboItemId: { in: ids } } });
    const allIds = [...new Set([...ids, ...combos.map((c) => c.componentItemId)])];
    const [ingredients, ctxs, modLines] = await Promise.all([
      this.loadIngredients(db, branchId),
      this.loadDishContexts(db, allIds),
      this.loadModifierLines(db, [...new Set(lines.flatMap((l) => l.modifierIds))]),
    ]);
    const portionCost = (id: string): number | null => {
      const ctx = ctxs.get(id);
      if (!ctx) return null;
      if (ctx.isCombo) {
        let sum = 0;
        for (const c of combos.filter((x) => x.comboItemId === id)) {
          const part = ctxs.get(c.componentItemId);
          if (!part) return null;
          const pc = this.dishCost(part, ingredients).costPerPortion;
          if (pc === null) return null;
          sum += pc * c.quantity;
        }
        return sum;
      }
      if (ctx.tracking === 'NONE' && ctx.recipe.lines.length === 0) return null;
      return this.dishCost(ctx, ingredients).costPerPortion;
    };
    return lines.map((l) =>
      unitCostOfSale({
        costPerPortion: portionCost(l.menuItemId),
        portionRatio: l.portionRatio,
        modifierCosts: l.modifierIds.map((mid) => {
          const ml = modLines.get(mid);
          return ml && ml.length > 0 ? this.modifierCost(ml, ingredients).cost : 0;
        }),
      }),
    );
  }
}
