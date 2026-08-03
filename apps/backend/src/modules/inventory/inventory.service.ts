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
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../common/money';
import { StockService } from './stock.service';

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
    return recipe;
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
  // passed through, not opened here — see StockService.consumeStock).
  // Deliberately best-effort and non-blocking: most menu items won't have a
  // recipe modeled yet, and a modeling gap or a mid-service substitution
  // should never be the reason a paid food order fails to save — that's a
  // strictly worse outcome than stock drifting negative and needing a
  // stocktake correction later. `allowNegative: true` on every consumeStock
  // call reflects that choice explicitly; waste logging (the other
  // consumeStock caller) makes the opposite choice on purpose, since a
  // waste entry has no such urgency.
  //
  // Combo items are expanded one level via ComboComponent — a combo's own
  // MenuItem row essentially never carries a direct recipe (its "recipe" is
  // its component items' recipes), so deducting only by comboItemId would
  // silently skip inventory for every combo sale. Combos-of-combos aren't a
  // real case in this schema (ComboComponent has no self-relation), so one
  // level of expansion is complete, not a partial implementation.
  async deductForOrderItems(
    tx: Tx,
    branchId: string,
    userId: string,
    items: { menuItemId: string; quantity: number }[],
  ): Promise<void> {
    if (items.length === 0) return;

    const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      select: { id: true, isCombo: true },
    });
    const isComboById = new Map(menuItems.map((m) => [m.id, m.isCombo]));

    const comboIds = menuItems.filter((m) => m.isCombo).map((m) => m.id);
    const comboComponents = comboIds.length
      ? await tx.comboComponent.findMany({
          where: { comboItemId: { in: comboIds } },
        })
      : [];
    const componentsByCombo = new Map<
      string,
      { componentItemId: string; quantity: number }[]
    >();
    for (const c of comboComponents) {
      const list = componentsByCombo.get(c.comboItemId) ?? [];
      list.push({ componentItemId: c.componentItemId, quantity: c.quantity });
      componentsByCombo.set(c.comboItemId, list);
    }

    // Flatten to (recipe-bearing menuItemId -> effective quantity sold),
    // expanding combos into their components.
    const effectiveQuantityByItem = new Map<string, number>();
    const addEffective = (menuItemId: string, quantity: number) => {
      effectiveQuantityByItem.set(
        menuItemId,
        (effectiveQuantityByItem.get(menuItemId) ?? 0) + quantity,
      );
    };
    for (const item of items) {
      if (isComboById.get(item.menuItemId)) {
        for (const component of componentsByCombo.get(item.menuItemId) ?? []) {
          addEffective(
            component.componentItemId,
            component.quantity * item.quantity,
          );
        }
      } else {
        addEffective(item.menuItemId, item.quantity);
      }
    }
    if (effectiveQuantityByItem.size === 0) return;

    const recipeLines = await tx.recipeIngredient.findMany({
      where: { menuItemId: { in: [...effectiveQuantityByItem.keys()] } },
    });
    if (recipeLines.length === 0) return;

    const ingredientQtyNeeded = new Map<string, number>();
    for (const line of recipeLines) {
      const soldQty = effectiveQuantityByItem.get(line.menuItemId) ?? 0;
      if (soldQty <= 0) continue;
      const needed = Number(line.quantity) * soldQty;
      ingredientQtyNeeded.set(
        line.ingredientId,
        (ingredientQtyNeeded.get(line.ingredientId) ?? 0) + needed,
      );
    }

    for (const [ingredientId, quantity] of ingredientQtyNeeded) {
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
        },
      );
    }
  }
}
