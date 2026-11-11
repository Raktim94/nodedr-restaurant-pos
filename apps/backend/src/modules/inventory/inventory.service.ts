import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  IngredientDto,
  SupplierDto,
  RecipeLineDto,
  MenuItemTrackingDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  convertQty,
  costRecipe,
  type CostUnit,
  type UnitConversion,
} from '@nodedr-restaurant/types';
import { round2 } from '../../common/money';
import { CostingConflict } from './costing.service';
import { StockService } from './stock.service';
import {
  planStockUsage,
  type PlanItem,
  type PlanLine,
  type StockPlan,
} from './stock-plan';
import { CostingCalcService } from './costing-calc.service';

/** One line of a sale as stock planning sees it. */
export interface SaleLine {
  orderItemId?: string;
  menuItemId: string;
  quantity: number;
  /** HALF / FULL / CUSTOM as ordered. */
  portion?: string | null;
  modifierIds?: string[];
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly calc: CostingCalcService,
  ) {}

  // --- Ingredients ----------------------------------------------------------

  listIngredients(branchId: string) {
    return this.prisma.ingredient.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async getIngredient(branchId: string, id: string) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id, branchId },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');
    return ingredient;
  }

  private ingredientData(
    dto: Partial<IngredientDto>,
    current?: {
      unit: string;
      purchaseUnit: string | null;
      purchaseQuantity: unknown;
      purchasePrice: unknown;
      conversions: unknown;
    },
  ) {
    const { conversions, ...rest } = dto;
    delete (rest as { baseVersion?: number }).baseVersion; // a lock token, not a column
    const unit = (dto.unit ?? current?.unit) as CostUnit | undefined;
    const qty =
      dto.purchaseQuantity !== undefined
        ? dto.purchaseQuantity
        : current?.purchaseQuantity == null
          ? null
          : Number(current.purchaseQuantity);
    const price =
      dto.purchasePrice !== undefined
        ? dto.purchasePrice
        : current?.purchasePrice == null
          ? null
          : Number(current.purchasePrice);
    const pUnit = (
      dto.purchaseUnit !== undefined ? dto.purchaseUnit : current?.purchaseUnit
    ) as CostUnit | null | undefined;
    const conv = (conversions ??
      current?.conversions ??
      []) as UnitConversion[];
    if (unit && qty != null && price != null) {
      // The purchase pack must be convertible to the stock unit, or the cost per unit is unknowable.
      if (convertQty(Number(qty), pUnit ?? unit, unit, unit, conv) === null) {
        throw new BadRequestException(
          `Cannot convert the purchase unit (${(pUnit ?? unit).toLowerCase()}) to the stock unit (${unit.toLowerCase()}) - add a conversion for this ingredient`,
        );
      }
    }
    if ((qty != null) !== (price != null)) {
      throw new BadRequestException(
        'Enter both the purchase quantity and the purchase price, or neither',
      );
    }
    return {
      ...rest,
      ...(conversions !== undefined
        ? { conversions: conversions as unknown as Prisma.InputJsonValue }
        : {}),
    };
  }

  createIngredient(branchId: string, dto: IngredientDto) {
    return this.prisma.ingredient.create({
      data: {
        ...this.ingredientData(dto),
        name: dto.name,
        unit: dto.unit,
        branchId,
      },
    });
  }

  async updateIngredient(
    branchId: string,
    id: string,
    dto: Partial<IngredientDto>,
  ) {
    const current = await this.getIngredient(branchId, id);
    if (dto.baseVersion !== undefined && dto.baseVersion !== current.version) {
      throw new CostingConflict(
        'This ingredient was changed by someone else after you opened it.',
        current,
      );
    }
    if (dto.unit && dto.unit !== current.unit) {
      const used =
        (await this.prisma.recipeIngredient.count({
          where: { ingredientId: id },
        })) +
        (await this.prisma.preparationLine.count({
          where: { ingredientId: id },
        })) +
        (await this.prisma.modifierIngredient.count({
          where: { ingredientId: id },
        }));
      if (used > 0 || Number(current.currentStock) !== 0) {
        throw new BadRequestException(
          'The stock unit cannot change while the ingredient has stock or is used in recipes',
        );
      }
    }
    const data = this.ingredientData(dto, current);
    return this.prisma.ingredient.update({
      where: { id },
      data: { ...data, version: { increment: 1 } },
    });
  }

  async deleteIngredient(branchId: string, id: string) {
    await this.getIngredient(branchId, id);
    const usedInRecipe = await this.prisma.recipeIngredient.count({
      where: { ingredientId: id },
    });
    if (usedInRecipe > 0) {
      throw new BadRequestException(
        'Ingredient is used in a menu item recipe — remove it from every recipe first',
      );
    }
    await this.prisma.ingredient.delete({ where: { id } });
    return { ok: true };
  }

  async lowStockIngredients(branchId: string) {
    const ingredients = await this.listIngredients(branchId);
    return ingredients.filter(
      (i) => Number(i.currentStock) <= Number(i.reorderLevel),
    );
  }

  // --- Suppliers --------------------------------------------------------------

  listSuppliers(branchId: string) {
    return this.prisma.supplier.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async getSupplier(branchId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, branchId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  createSupplier(branchId: string, dto: SupplierDto) {
    return this.prisma.supplier.create({ data: { ...dto, branchId } });
  }

  async updateSupplier(
    branchId: string,
    id: string,
    dto: Partial<SupplierDto>,
  ) {
    await this.getSupplier(branchId, id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async deleteSupplier(branchId: string, id: string) {
    await this.getSupplier(branchId, id);
    const usedInPo = await this.prisma.purchaseOrder.count({
      where: { supplierId: id },
    });
    if (usedInPo > 0) {
      throw new BadRequestException(
        'Supplier has purchase orders on record — deactivate instead of deleting',
      );
    }
    await this.prisma.supplier.delete({ where: { id } });
    return { ok: true };
  }

  // --- Recipe costing -----------------------------------------------------------
  //
  // costPerUnit on Ingredient is a weighted-average, kept current by
  // GoodsReceiptsService on every GRN — so recipe cost here is always a
  // live, accurate read, not a stale snapshot recomputed on a timer.

  async getRecipe(branchId: string, menuItemId: string) {
    await this.assertMenuItemInBranch(branchId, menuItemId);
    const [ctxs, ingredients] = await Promise.all([
      this.calc.loadDishContexts(this.prisma, [menuItemId]),
      this.calc.loadIngredients(this.prisma, branchId),
    ]);
    const ctx = ctxs.get(menuItemId);
    const lines = await this.prisma.recipeIngredient.findMany({
      where: { menuItemId },
      orderBy: { createdAt: 'asc' },
    });
    const rc = costRecipe(
      ctx?.recipe ?? { lines: [], batchOutputQty: 1 },
      ingredients,
    );
    const byIngredient = new Map(rc.lines.map((l) => [l.ingredientId, l]));
    const costed = lines.map((line) => {
      const l = byIngredient.get(line.ingredientId);
      const ing = ingredients.get(line.ingredientId);
      return {
        id: line.id,
        ingredientId: line.ingredientId,
        ingredientName: ing?.name ?? '',
        unit: l?.unit ?? ing?.unit ?? 'PIECE',
        quantity: Number(line.quantity),
        costPerUnit: ing ? Number(ing.costPerUnit) : 0,
        lineCost: round2(l?.lineCost ?? 0),
      };
    });
    return {
      lines: costed,
      totalCost: round2(rc.costPerPortion ?? rc.batchCost),
    };
  }

  async setRecipe(
    branchId: string,
    menuItemId: string,
    lines: RecipeLineDto[],
  ) {
    await this.assertMenuItemInBranch(branchId, menuItemId);
    const tracking = await this.prisma.menuItem.findUniqueOrThrow({
      where: { id: menuItemId },
      select: { inventoryTracking: true },
    });
    if (tracking.inventoryTracking === 'DIRECT' && lines.length > 0) {
      throw new BadRequestException(
        'This item deducts finished stock when sold - switch it to Recipe before listing ingredients',
      );
    }

    const ingredientIds = lines.map((l) => l.ingredientId);
    if (new Set(ingredientIds).size !== ingredientIds.length) {
      throw new BadRequestException('Duplicate ingredient in recipe');
    }
    if (ingredientIds.length > 0) {
      const count = await this.prisma.ingredient.count({
        where: { id: { in: ingredientIds }, branchId },
      });
      if (count !== ingredientIds.length) {
        throw new BadRequestException(
          'One or more ingredients not found in this branch',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.recipeIngredient.deleteMany({ where: { menuItemId } });
      if (lines.length > 0) {
        await tx.recipeIngredient.createMany({
          data: lines.map((l) => ({
            menuItemId,
            ingredientId: l.ingredientId,
            quantity: l.quantity,
            unit: l.unit ?? null,
          })),
        });
      }
    });

    const recipe = await this.getRecipe(branchId, menuItemId);
    await this.prisma.menuItem.update({
      where: { id: menuItemId },
      data: { costPrice: recipe.totalCost },
    });
    // Saving recipe lines on an untracked item means "deduct these when sold".
    if (lines.length > 0) {
      await this.prisma.menuItem.updateMany({
        where: { id: menuItemId, inventoryTracking: 'NONE' },
        data: { inventoryTracking: 'RECIPE' },
      });
    }
    return recipe;
  }

  async getTracking(branchId: string, menuItemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId },
      select: {
        id: true,
        inventoryTracking: true,
        stockIngredientId: true,
        stockQuantityPerSale: true,
        isCombo: true,
      },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    return {
      ...item,
      stockQuantityPerSale: Number(item.stockQuantityPerSale),
    };
  }

  async setTracking(
    branchId: string,
    menuItemId: string,
    dto: MenuItemTrackingDto,
  ) {
    await this.assertMenuItemInBranch(branchId, menuItemId);
    if (dto.inventoryTracking === 'DIRECT') {
      const ingredient = await this.prisma.ingredient.findFirst({
        where: { id: dto.stockIngredientId ?? '', branchId },
        select: { id: true },
      });
      if (!ingredient) {
        throw new BadRequestException('Stock item not found in this branch');
      }
    }
    await this.prisma.menuItem.update({
      where: { id: menuItemId },
      data: {
        inventoryTracking: dto.inventoryTracking,
        stockIngredientId:
          dto.inventoryTracking === 'DIRECT' ? dto.stockIngredientId : null,
        stockQuantityPerSale:
          dto.inventoryTracking === 'DIRECT'
            ? (dto.stockQuantityPerSale ?? 1)
            : 1,
      },
    });
    return this.getTracking(branchId, menuItemId);
  }

  private async assertMenuItemInBranch(branchId: string, menuItemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Menu item not found');
  }

  // --- Automatic deduction on order checkout ------------------------------
  //
  // Called from OrdersService.checkout() inside its own transaction (`tx`
  // passed through, not opened here), so the movements, the ingredient
  // balances and the OPEN->PAID order update commit or roll back together.
  // What moves is decided by planStockUsage(): RECIPE items deduct their
  // recipe lines (usable quantity grossed up by ingredient yield, once, and
  // scaled to one portion by the batch output), DIRECT items deduct one stock
  // item (a prepared batch's FINISHED stock - its raw ingredients were taken
  // at production and are never taken again here), NONE items nothing,
  // combos expand into their components. Half portions use the item's
  // halfPortionRatio; chosen options add or remove their own ingredients.
  // Stock may go negative on purpose (allowNegative): a shortage must never
  // block a paid sale, it shows up as a negative balance for the next
  // stocktake. Tracked items that cannot be mapped to stock are returned in
  // `skipped` and reported by the caller - never silently ignored.
  //
  // The production cost of every sold unit is frozen onto the order item here
  // (unitCostSnapshot), so history never changes when purchase prices do.
  //
  // Idempotent per order: checkout's guarded status update already makes
  // double-payment impossible; the CONSUMPTION lookup is a second line of
  // defence against any retry path re-running this for the same order.
  async deductForOrder(
    tx: Tx,
    branchId: string,
    userId: string,
    orderId: string,
    lines: SaleLine[],
  ): Promise<{ skipped: StockPlan['skipped'] }> {
    if (lines.length === 0) return { skipped: [] };
    const already = await tx.stockMovement.count({
      where: { orderId, type: 'CONSUMPTION' },
    });
    if (already > 0) return { skipped: [] };

    const { plan, ratios, modifiers } = await this.planFor(tx, branchId, lines);
    for (const [ingredientId, quantity] of plan.needs) {
      if (quantity <= 0) continue;
      await this.stockService.consumeStock(
        tx,
        branchId,
        ingredientId,
        quantity,
        {
          type: 'CONSUMPTION',
          note: 'Order checkout',
          userId,
          allowNegative: true,
          orderId,
        },
      );
    }
    await this.freezeUnitCosts(tx, branchId, lines, ratios, modifiers);
    return { skipped: plan.skipped };
  }

  private async freezeUnitCosts(
    tx: Tx,
    branchId: string,
    lines: SaleLine[],
    ratios: number[],
    modifiers: string[][],
  ) {
    const costs = await this.calc.unitCostsForSale(
      tx,
      branchId,
      lines.map((l, i) => ({
        menuItemId: l.menuItemId,
        portionRatio: ratios[i],
        modifierIds: modifiers[i],
      })),
    );
    for (const [i, l] of lines.entries()) {
      if (!l.orderItemId) continue;
      await tx.orderItem.update({
        where: { id: l.orderItemId },
        data: { portionRatio: ratios[i] },
      });
      // Only a fully known cost is stored; an unpriced line leaves no figure rather than a wrong one.
      if (costs[i] !== null) {
        await tx.orderItemCost.upsert({
          where: { orderItemId: l.orderItemId },
          update: {},
          create: { orderItemId: l.orderItemId, unitCost: costs[i] },
        });
      }
    }
  }

  // Puts physically returned units back in stock (compensating REVERSAL
  // movements). Only called when a refund explicitly names the returned
  // items; a money-only refund never reaches here. Uses the portion and
  // options frozen on the order item, so a returned Half comes back as a Half.
  async restoreForReturn(
    tx: Tx,
    branchId: string,
    userId: string,
    orderId: string,
    lines: SaleLine[],
  ): Promise<{ restored: number }> {
    const { plan } = await this.planFor(tx, branchId, lines, true);
    let restored = 0;
    for (const [ingredientId, quantity] of plan.needs) {
      restored += await this.stockService.restoreStock(
        tx,
        branchId,
        ingredientId,
        quantity,
        { userId, orderId, note: 'Returned with refund' },
      );
    }
    return { restored };
  }

  private async planFor(
    tx: Tx,
    branchId: string,
    sale: SaleLine[],
    useFrozenRatio = false,
  ): Promise<{ plan: StockPlan; ratios: number[]; modifiers: string[][] }> {
    const ids = [...new Set(sale.map((l) => l.menuItemId))];
    const combos = await tx.comboComponent.findMany({
      where: { comboItemId: { in: ids } },
    });
    const allIds = [
      ...new Set([...ids, ...combos.map((c) => c.componentItemId)]),
    ];
    // The order items themselves say which portion and options were sold, so callers only name them.
    const orderItemIds = sale
      .map((l) => l.orderItemId)
      .filter((x): x is string => !!x);
    const soldItems = orderItemIds.length
      ? await tx.orderItem.findMany({
          where: { id: { in: orderItemIds } },
          select: {
            id: true,
            portion: true,
            portionRatio: true,
            modifiers: { select: { modifierId: true } },
          },
        })
      : [];
    const soldById = new Map(soldItems.map((i) => [i.id, i]));
    const modifierIdsOf = (l: SaleLine) =>
      l.modifierIds ??
      soldById.get(l.orderItemId ?? '')?.modifiers.map((m) => m.modifierId) ??
      [];
    const [ctxs, ingredients, modLines] = await Promise.all([
      this.calc.loadDishContexts(tx, allIds),
      this.calc.loadIngredients(tx, branchId),
      this.calc.loadModifierLines(tx, [
        ...new Set(sale.flatMap(modifierIdsOf)),
      ]),
    ]);
    const items = new Map<string, PlanItem>();
    for (const ctx of ctxs.values()) {
      items.set(ctx.id, {
        id: ctx.id,
        name: ctx.name,
        isCombo: ctx.isCombo,
        tracking: ctx.tracking,
        stockIngredientId: ctx.stockIngredientId,
        stockQuantityPerSale: ctx.stockQuantityPerSale,
        recipe:
          ctx.tracking === 'RECIPE'
            ? this.calc.recipeNeedsPerPortion(ctx, ingredients).map((x) => ({
                ingredientId: x.ingredientId,
                quantity: x.rawStockQty,
              }))
            : [],
      });
    }
    const ratios = sale.map((l) => {
      const sold = soldById.get(l.orderItemId ?? '');
      // On a return, use the ratio frozen when the sale was paid so the same stock comes back.
      if (useFrozenRatio && sold) return Number(sold.portionRatio);
      const portion = l.portion ?? sold?.portion;
      const ctx = ctxs.get(l.menuItemId);
      return portion === 'HALF' && ctx?.halfPortionRatio
        ? ctx.halfPortionRatio
        : 1;
    });
    const planLines: PlanLine[] = sale.map((l, i) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      portionRatio: ratios[i],
      extras: modifierIdsOf(l).flatMap((mid) => {
        const ml = modLines.get(mid);
        if (!ml) return [];
        return this.calc
          .modifierCost(ml, ingredients)
          .lines.filter((x) => x.rawStockQty !== null)
          .map((x) => ({
            ingredientId: x.ingredientId,
            quantity: x.rawStockQty as number,
          }));
      }),
    }));
    return {
      plan: planStockUsage(planLines, items, combos),
      ratios,
      modifiers: sale.map(modifierIdsOf),
    };
  }

  // Setup status: sellable items whose inventory tracking is switched on but
  // not mapped to any stock, so selling them would deduct nothing.
  async trackingSetupStatus(branchId: string) {
    const items = await this.prisma.menuItem.findMany({
      where: {
        branchId,
        isActive: true,
        isCombo: false,
        inventoryTracking: { not: 'NONE' },
      },
      select: {
        id: true,
        name: true,
        inventoryTracking: true,
        stockIngredientId: true,
        stockQuantityPerSale: true,
        _count: { select: { recipeLines: true } },
      },
      orderBy: { name: 'asc' },
    });
    const problems = items.flatMap<StockPlan['skipped'][number]>((i) => {
      if (i.inventoryTracking === 'RECIPE' && i._count.recipeLines === 0) {
        return [
          { menuItemId: i.id, name: i.name, reason: 'NO_RECIPE' as const },
        ];
      }
      if (
        i.inventoryTracking === 'DIRECT' &&
        (!i.stockIngredientId || Number(i.stockQuantityPerSale) <= 0)
      ) {
        return [
          { menuItemId: i.id, name: i.name, reason: 'NO_STOCK_ITEM' as const },
        ];
      }
      return [];
    });
    const [untracked, tracked] = await Promise.all([
      this.prisma.menuItem.count({
        where: {
          branchId,
          isActive: true,
          isCombo: false,
          inventoryTracking: 'NONE',
        },
      }),
      this.prisma.menuItem.count({
        where: {
          branchId,
          isActive: true,
          isCombo: false,
          inventoryTracking: { not: 'NONE' },
        },
      }),
    ]);
    return { tracked, untracked, problems };
  }
}
