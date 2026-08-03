import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  IngredientDto,
  SupplierDto,
  RecipeLineDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round2 } from '../../common/money';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

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
}
