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
import { round2 } from '../../common/money';
import { StockService } from './stock.service';
import { planStockUsage, type PlanItem, type StockPlan } from './stock-plan';

type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
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

  createIngredient(branchId: string, dto: IngredientDto) {
    return this.prisma.ingredient.create({ data: { ...dto, branchId } });
  }

  async updateIngredient(
    branchId: string,
    id: string,
    dto: Partial<IngredientDto>,
  ) {
    await this.getIngredient(branchId, id);
    return this.prisma.ingredient.update({ where: { id }, data: dto });
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
    const lines = await this.prisma.recipeIngredient.findMany({
      where: { menuItemId },
      include: { ingredient: true },
      orderBy: { createdAt: 'asc' },
    });
    const costed = lines.map((line) => ({
      id: line.id,
      ingredientId: line.ingredientId,
      ingredientName: line.ingredient.name,
      unit: line.ingredient.unit,
      quantity: Number(line.quantity),
      costPerUnit: Number(line.ingredient.costPerUnit),
      lineCost: round2(
        Number(line.quantity) * Number(line.ingredient.costPerUnit),
      ),
    }));
    const totalCost = round2(costed.reduce((sum, l) => sum + l.lineCost, 0));
    return { lines: costed, totalCost };
  }

  async setRecipe(
    branchId: string,
    menuItemId: string,
    lines: RecipeLineDto[],
  ) {
    await this.assertMenuItemInBranch(branchId, menuItemId);

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
  // recipe lines, DIRECT items deduct one stock item, NONE items nothing,
  // combos expand into their components. Stock may go negative on purpose
  // (allowNegative): a shortage must never block a paid sale, it shows up as
  // a negative balance for the next stocktake. Tracked items that cannot be
  // mapped to stock are returned in `skipped` and reported by the caller -
  // never silently ignored.
  //
  // Idempotent per order: checkout's guarded status update already makes
  // double-payment impossible; the CONSUMPTION lookup is a second line of
  // defence against any retry path re-running this for the same order.
  async deductForOrder(
    tx: Tx,
    branchId: string,
    userId: string,
    orderId: string,
    lines: { menuItemId: string; quantity: number }[],
  ): Promise<{ skipped: StockPlan['skipped'] }> {
    if (lines.length === 0) return { skipped: [] };
    const already = await tx.stockMovement.count({
      where: { orderId, type: 'CONSUMPTION' },
    });
    if (already > 0) return { skipped: [] };

    const plan = await this.planFor(tx, lines);
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
    return { skipped: plan.skipped };
  }

  // Puts physically returned units back in stock (compensating REVERSAL
  // movements). Only called when a refund explicitly names the returned
  // items; a money-only refund never reaches here.
  async restoreForReturn(
    tx: Tx,
    branchId: string,
    userId: string,
    orderId: string,
    lines: { menuItemId: string; quantity: number }[],
  ): Promise<{ restored: number }> {
    const plan = await this.planFor(tx, lines);
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
    lines: { menuItemId: string; quantity: number }[],
  ): Promise<StockPlan> {
    const ids = [...new Set(lines.map((l) => l.menuItemId))];
    const combos = await tx.comboComponent.findMany({
      where: { comboItemId: { in: ids } },
    });
    const allIds = [
      ...new Set([...ids, ...combos.map((c) => c.componentItemId)]),
    ];
    const rows = await tx.menuItem.findMany({
      where: { id: { in: allIds } },
      include: { recipeLines: true },
    });
    const items = new Map<string, PlanItem>(
      rows.map((m) => [
        m.id,
        {
          id: m.id,
          name: m.name,
          isCombo: m.isCombo,
          tracking: m.inventoryTracking,
          stockIngredientId: m.stockIngredientId,
          stockQuantityPerSale: Number(m.stockQuantityPerSale),
          recipe: m.recipeLines.map((l) => ({
            ingredientId: l.ingredientId,
            quantity: Number(l.quantity),
          })),
        },
      ]),
    );
    return planStockUsage(lines, items, combos);
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
