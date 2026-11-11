import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  costRecipe,
  effectiveUnitCost,
  marginAlert,
  permissionSatisfied,
  profitability,
  round3,
  round4,
  stockNeedsForPortions,
  suggestPrice,
  wouldCreateCycle,
  type ApplyPriceDto,
  type CostIngredient,
  type CostUnit,
  type MenuItemCostingDto,
  type ModifierCostingDto,
  type Overhead,
  type PreparationDto,
  type ProductionRunDto,
  type TaxModeCost,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CostingCalcService,
  toCostIngredient,
  type DishContext,
} from './costing-calc.service';
import { StockService } from './stock.service';

type Tx = Prisma.TransactionClient;
const n = (v: unknown): number => Number(v);

export class CostingConflict extends ConflictException {
  constructor(message: string, current: unknown) {
    super({ statusCode: 409, code: 'COSTING_CONFLICT', message, current });
  }
}

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calc: CostingCalcService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // --- Reading ---------------------------------------------------------------

  private async branchTax(branchId: string): Promise<TaxModeCost> {
    const b = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { taxMode: true },
    });
    return b.taxMode;
  }

  private analyse(
    ctx: DishContext,
    cost: number | null,
    taxMode: TaxModeCost,
    listedPrice: number,
  ) {
    const profit =
      cost === null
        ? null
        : profitability({
            cost,
            listedPrice,
            taxRatePercent: ctx.taxRatePercent,
            taxMode,
          });
    const c = ctx.costing;
    const suggestions =
      cost === null
        ? { margin: null, markup: null }
        : {
            margin:
              c?.targetMarginPercent != null
                ? suggestPrice({
                    cost,
                    method: 'MARGIN',
                    percent: c.targetMarginPercent,
                    taxRatePercent: ctx.taxRatePercent,
                    taxMode,
                  })
                : null,
            markup:
              c?.targetMarkupPercent != null
                ? suggestPrice({
                    cost,
                    method: 'MARKUP',
                    percent: c.targetMarkupPercent,
                    taxRatePercent: ctx.taxRatePercent,
                    taxMode,
                  })
                : null,
          };
    const net = profit?.netRevenue ?? 0;
    const alert = marginAlert({
      baselineCost: c?.baselineCost ?? null,
      currentCost: cost,
      netRevenue: net,
      thresholdPoints: c?.alertDropPoints ?? 5,
      targetMarginPercent: c?.targetMarginPercent ?? null,
    });
    return { profit, suggestions, alert };
  }

  /** Everything the recipe editor shows for one menu item. */
  async getMenuItem(branchId: string, menuItemId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId },
      include: {
        costing: true,
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            modifierGroup: {
              include: { modifiers: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    const taxMode = await this.branchTax(branchId);
    const [ingredients, ctxs] = await Promise.all([
      this.calc.loadIngredients(this.prisma, branchId),
      this.calc.loadDishContexts(this.prisma, [menuItemId]),
    ]);
    const ctx = ctxs.get(menuItemId) as DishContext;
    const dish = this.calc.dishCost(ctx, ingredients);

    const modifierIds = item.modifierGroups.flatMap((g) =>
      g.modifierGroup.modifiers.map((m) => m.id),
    );
    const modLines = await this.calc.loadModifierLines(
      this.prisma,
      modifierIds,
    );
    const modifiers = item.modifierGroups.flatMap((g) =>
      g.modifierGroup.modifiers.map((m) => {
        const lines = modLines.get(m.id) ?? [];
        const mc = lines.length
          ? this.calc.modifierCost(lines, ingredients)
          : null;
        const price = n(m.priceAdjustment);
        return {
          id: m.id,
          groupName: g.modifierGroup.name,
          name: m.name,
          priceAdjustment: price,
          lines,
          cost: mc ? mc.cost : 0,
          complete: mc ? mc.complete : true,
          hasIngredients: lines.length > 0,
        };
      }),
    );

    const cost = dish.costPerPortion;
    const full = this.analyse(ctx, cost, taxMode, ctx.price);
    const halfRatio = ctx.halfPortionRatio ?? 0.5;
    const half =
      ctx.halfPrice != null
        ? {
            ratio: halfRatio,
            costPerPortion: cost === null ? null : round4(cost * halfRatio),
            ...this.analyse(
              ctx,
              cost === null ? null : cost * halfRatio,
              taxMode,
              ctx.halfPrice,
            ),
          }
        : null;

    const c = item.costing;
    return {
      menuItemId: item.id,
      name: item.name,
      isCombo: item.isCombo,
      taxMode,
      taxRatePercent: ctx.taxRatePercent,
      price: ctx.price,
      halfPrice: ctx.halfPrice,
      tracking: {
        inventoryTracking: item.inventoryTracking,
        stockIngredientId: item.stockIngredientId,
        stockQuantityPerSale: n(item.stockQuantityPerSale),
      },
      version: c?.version ?? 0,
      config: {
        batchOutputQty: c ? n(c.batchOutputQty) : 1,
        overheads: (c && Array.isArray(c.overheads)
          ? c.overheads
          : []) as unknown as Overhead[],
        halfPortionRatio: halfRatio,
        targetMarginPercent:
          c?.targetMarginPercent == null ? null : n(c.targetMarginPercent),
        targetMarkupPercent:
          c?.targetMarkupPercent == null ? null : n(c.targetMarkupPercent),
        alertDropPoints: c ? n(c.alertDropPoints) : 5,
        baselineCost: c?.baselineCost == null ? null : n(c.baselineCost),
        baselineAt: c?.baselineAt ?? null,
      },
      lines: ctx.recipe.lines,
      cost: dish,
      profitability: full.profit,
      suggestions: full.suggestions,
      alert: full.alert,
      half,
      modifiers,
    };
  }

  /** One row per sellable item: cost, margin and any margin warning. */
  async overview(branchId: string) {
    const taxMode = await this.branchTax(branchId);
    const items = await this.prisma.menuItem.findMany({
      where: { branchId, isActive: true, isCombo: false },
      select: { id: true, name: true, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const [ingredients, ctxs] = await Promise.all([
      this.calc.loadIngredients(this.prisma, branchId),
      this.calc.loadDishContexts(
        this.prisma,
        items.map((i) => i.id),
      ),
    ]);
    const rows = items.map((i) => {
      const ctx = ctxs.get(i.id) as DishContext;
      const dish = this.calc.dishCost(ctx, ingredients);
      const a = this.analyse(ctx, dish.costPerPortion, taxMode, ctx.price);
      return {
        menuItemId: i.id,
        name: i.name,
        category: i.category.name,
        price: ctx.price,
        source: dish.source,
        costPerPortion: dish.costPerPortion,
        complete: dish.complete,
        foodCostPercent: a.profit?.foodCostPercent ?? null,
        grossMarginPercent: a.profit?.grossMarginPercent ?? null,
        grossProfit: a.profit?.grossProfit ?? null,
        alert: a.alert.level,
        alertMessage: a.alert.message,
        targetMarginPercent: ctx.costing?.targetMarginPercent ?? null,
      };
    });
    return {
      taxMode,
      items: rows,
      alerts: rows.filter((r) => r.alert === 'WATCH' || r.alert === 'LOSS'),
      unpriced: rows.filter((r) => r.source !== 'NONE' && !r.complete).length,
      withoutRecipe: rows.filter((r) => r.source === 'NONE').length,
    };
  }

  // --- Saving a recipe -----------------------------------------------------------

  private async assertIngredients(
    db: Tx | PrismaService,
    branchId: string,
    ids: string[],
  ) {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'The same ingredient is listed twice - combine the lines',
      );
    }
    if (ids.length === 0) return;
    const found = await db.ingredient.count({
      where: { id: { in: ids }, branchId },
    });
    if (found !== ids.length)
      throw new BadRequestException(
        'One or more ingredients are not in this branch',
      );
  }

  async saveMenuItem(
    branchId: string,
    userId: string,
    menuItemId: string,
    dto: MenuItemCostingDto,
  ) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId },
      select: { id: true, isCombo: true, inventoryTracking: true },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    if (item.isCombo)
      throw new BadRequestException(
        'Combos are costed through their component items',
      );
    if (item.inventoryTracking === 'DIRECT' && dto.lines.length > 0) {
      throw new BadRequestException(
        'This item deducts finished stock when sold. Switch it to "Recipe" to list ingredients - raw ingredients are never taken twice.',
      );
    }
    const ids = dto.lines.map((l) => l.ingredientId);
    await this.assertIngredients(this.prisma, branchId, ids);

    // Reject lines that can never be converted: stock deduction would not know what to take.
    const ingredients = await this.calc.loadIngredients(this.prisma, branchId);
    const check = costRecipe(
      {
        lines: dto.lines,
        batchOutputQty: dto.batchOutputQty,
        overheads: dto.overheads,
      },
      ingredients,
    );
    const hard = check.issues.find(
      (i) =>
        i.code === 'INCOMPATIBLE_UNIT' ||
        i.code === 'INVALID_QUANTITY' ||
        i.code === 'CIRCULAR',
    );
    if (hard) throw new BadRequestException(hard.message);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.menuItemCosting.findUnique({
        where: { menuItemId },
      });
      if (
        existing &&
        dto.baseVersion !== undefined &&
        dto.baseVersion !== existing.version
      ) {
        throw new CostingConflict(
          'This recipe was changed by someone else after you opened it.',
          await this.getMenuItemInTx(tx, branchId, menuItemId).catch(
            () => null,
          ),
        );
      }
      await tx.recipeIngredient.deleteMany({ where: { menuItemId } });
      if (dto.lines.length > 0) {
        await tx.recipeIngredient.createMany({
          data: dto.lines.map((l) => ({
            menuItemId,
            ingredientId: l.ingredientId,
            quantity: l.quantity,
            unit: l.unit ?? null,
          })),
        });
      }
      const data = {
        batchOutputQty: dto.batchOutputQty,
        overheads: dto.overheads as unknown as Prisma.InputJsonValue,
        halfPortionRatio: dto.halfPortionRatio,
        targetMarginPercent: dto.targetMarginPercent ?? null,
        targetMarkupPercent: dto.targetMarkupPercent ?? null,
        alertDropPoints: dto.alertDropPoints,
        updatedById: userId,
      };
      const first = check.costPerPortion;
      if (existing) {
        await tx.menuItemCosting.update({
          where: { menuItemId },
          data: {
            ...data,
            version: { increment: 1 },
            ...(existing.baselineCost === null && first !== null
              ? { baselineCost: first, baselineAt: new Date() }
              : {}),
          },
        });
      } else {
        await tx.menuItemCosting.create({
          data: {
            ...data,
            branchId,
            menuItemId,
            ...(first !== null
              ? { baselineCost: first, baselineAt: new Date() }
              : {}),
          },
        });
      }
      if (dto.lines.length > 0 && item.inventoryTracking === 'NONE') {
        await tx.menuItem.update({
          where: { id: menuItemId },
          data: { inventoryTracking: 'RECIPE' },
        });
      }
      if (first !== null) {
        await tx.menuItem.update({
          where: { id: menuItemId },
          data: { costPrice: first },
        });
      }
    });
    await this.audit.record({
      userId,
      action: 'recipe.update',
      entity: 'MenuItem',
      entityId: menuItemId,
      metadata: {
        lines: dto.lines.length,
        batchOutputQty: dto.batchOutputQty,
        costPerPortion: check.costPerPortion,
      },
    });
    return this.getMenuItem(branchId, menuItemId);
  }

  private getMenuItemInTx(_tx: Tx, branchId: string, menuItemId: string) {
    // Read the committed state for the conflict reply (the failing tx has changed nothing).
    return this.getMenuItem(branchId, menuItemId);
  }

  /** "I've seen the new cost and the price is fine": today's cost becomes the warning baseline. */
  async acknowledge(branchId: string, userId: string, menuItemId: string) {
    const view = await this.getMenuItem(branchId, menuItemId);
    if (view.cost.costPerPortion === null)
      throw new BadRequestException('The cost is not fully priced yet');
    await this.prisma.menuItemCosting.upsert({
      where: { menuItemId },
      update: {
        baselineCost: view.cost.costPerPortion,
        baselineAt: new Date(),
        updatedById: userId,
      },
      create: {
        branchId,
        menuItemId,
        baselineCost: view.cost.costPerPortion,
        baselineAt: new Date(),
        updatedById: userId,
      },
    });
    return this.getMenuItem(branchId, menuItemId);
  }

  /**
   * Changes the menu price to a figure the user chose. This is the ONLY way costing touches a
   * price, it needs menu.manage on top of costing access, and it refuses if the price moved since
   * the user looked (so a stale suggestion never overwrites a newer price).
   */
  async applyPrice(
    branchId: string,
    user: { id: string; permissions: string[] },
    menuItemId: string,
    dto: ApplyPriceDto,
  ) {
    if (!permissionSatisfied(user.permissions, 'menu.manage')) {
      throw new ForbiddenException(
        'Changing a selling price needs the Manage Menu permission',
      );
    }
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, branchId },
      select: { id: true, price: true, halfPrice: true },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    const field = dto.target === 'HALF' ? 'halfPrice' : 'price';
    const current = item[field];
    if (field === 'halfPrice' && current == null) {
      throw new BadRequestException('This item has no half portion price');
    }
    if (Math.abs(n(current) - dto.expectedCurrentPrice) > 0.004) {
      throw new CostingConflict(
        'The selling price changed since you opened this screen.',
        await this.getMenuItem(branchId, menuItemId),
      );
    }
    await this.prisma.menuItem.update({
      where: { id: menuItemId },
      data: { [field]: dto.price },
    });
    const view = await this.getMenuItem(branchId, menuItemId);
    if (view.cost.costPerPortion !== null) {
      await this.prisma.menuItemCosting.upsert({
        where: { menuItemId },
        update: {
          baselineCost: view.cost.costPerPortion,
          baselineAt: new Date(),
          updatedById: user.id,
        },
        create: {
          branchId,
          menuItemId,
          baselineCost: view.cost.costPerPortion,
          baselineAt: new Date(),
          updatedById: user.id,
        },
      });
    }
    await this.audit.record({
      userId: user.id,
      action: 'menu_item.price_applied',
      entity: 'MenuItem',
      entityId: menuItemId,
      metadata: {
        field,
        from: n(current),
        to: dto.price,
        costPerPortion: view.cost.costPerPortion,
      },
    });
    return this.getMenuItem(branchId, menuItemId);
  }

  // --- Option (modifier) ingredients ----------------------------------------------

  async setModifier(
    branchId: string,
    modifierId: string,
    dto: ModifierCostingDto,
  ) {
    const mod = await this.prisma.modifier.findFirst({
      where: { id: modifierId, group: { branchId } },
      select: { id: true },
    });
    if (!mod) throw new NotFoundException('Option not found');
    await this.assertIngredients(
      this.prisma,
      branchId,
      dto.lines.map((l) => l.ingredientId),
    );
    const ingredients = await this.calc.loadIngredients(this.prisma, branchId);
    for (const l of dto.lines) {
      const r = costRecipe(
        {
          lines: [
            {
              ingredientId: l.ingredientId,
              quantity: Math.abs(l.quantity),
              unit: l.unit,
            },
          ],
          batchOutputQty: 1,
        },
        ingredients,
      );
      const hard = r.issues.find((i) => i.code === 'INCOMPATIBLE_UNIT');
      if (hard) throw new BadRequestException(hard.message);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.modifierIngredient.deleteMany({ where: { modifierId } });
      if (dto.lines.length) {
        await tx.modifierIngredient.createMany({
          data: dto.lines.map((l) => ({
            modifierId,
            ingredientId: l.ingredientId,
            quantity: l.quantity,
            unit: l.unit ?? null,
          })),
        });
      }
    });
    return { ok: true };
  }

  // --- Preparations (sauces, dough, spice mixes) ----------------------------------

  private prepView(
    ing: {
      id: string;
      name: string;
      unit: string;
      currentStock: unknown;
      costPerUnit: unknown;
    },
    prep: {
      id: string;
      version: number;
      batchOutputQty: unknown;
      overheads: unknown;
      lines: { ingredientId: string; quantity: unknown; unit: string | null }[];
    },
    ingredients: Map<string, CostIngredient>,
  ) {
    const recipe = {
      batchOutputQty: n(prep.batchOutputQty),
      overheads: (Array.isArray(prep.overheads)
        ? prep.overheads
        : []) as unknown as Overhead[],
      lines: prep.lines.map((l) => ({
        ingredientId: l.ingredientId,
        quantity: n(l.quantity),
        unit: l.unit as CostUnit | null,
      })),
    };
    const cost = costRecipe(recipe, ingredients, { trail: [ing.id] });
    return {
      id: ing.id, // the output ingredient's id is the preparation's public id
      preparationId: prep.id,
      name: ing.name,
      unit: ing.unit,
      version: prep.version,
      batchOutputQty: recipe.batchOutputQty,
      overheads: recipe.overheads,
      lines: recipe.lines,
      cost,
      currentStock: n(ing.currentStock),
      averageCostPerUnit: n(ing.costPerUnit),
    };
  }

  async listPreparations(branchId: string) {
    const rows = await this.prisma.preparation.findMany({
      where: { branchId },
      include: { outputIngredient: true, lines: true },
      orderBy: { outputIngredient: { name: 'asc' } },
    });
    const ingredients = await this.calc.loadIngredients(this.prisma, branchId);
    return rows.map((p) => this.prepView(p.outputIngredient, p, ingredients));
  }

  async getPreparation(branchId: string, outputIngredientId: string) {
    const p = await this.prisma.preparation.findFirst({
      where: { branchId, outputIngredientId },
      include: {
        outputIngredient: true,
        lines: true,
        productionRuns: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!p) throw new NotFoundException('Preparation not found');
    const ingredients = await this.calc.loadIngredients(this.prisma, branchId);
    return {
      ...this.prepView(p.outputIngredient, p, ingredients),
      runs: p.productionRuns.map((r) => ({
        id: r.id,
        batches: n(r.batches),
        outputQty: n(r.outputQty),
        totalCost: n(r.totalCost),
        unitCost: n(r.unitCost),
        note: r.note,
        createdAt: r.createdAt,
      })),
    };
  }

  private async validatePrepLines(
    branchId: string,
    outputId: string | null,
    dto: PreparationDto,
  ) {
    const ids = dto.lines.map((l) => l.ingredientId);
    await this.assertIngredients(this.prisma, branchId, ids);
    const ingredients = await this.calc.loadIngredients(this.prisma, branchId);
    if (outputId && ids.includes(outputId)) {
      throw new BadRequestException(
        'A preparation cannot use itself as an ingredient',
      );
    }
    if (outputId) {
      const usesOf = (id: string) =>
        ingredients.get(id)?.preparation?.lines.map((l) => l.ingredientId) ??
        [];
      if (wouldCreateCycle(outputId, ids, usesOf)) {
        throw new BadRequestException(
          'That would make the preparation depend on itself through another preparation',
        );
      }
    }
    const probe = costRecipe(
      {
        lines: dto.lines,
        batchOutputQty: dto.batchOutputQty,
        overheads: dto.overheads,
      },
      ingredients,
    );
    const hard = probe.issues.find(
      (i) =>
        i.code === 'INCOMPATIBLE_UNIT' ||
        i.code === 'INVALID_QUANTITY' ||
        i.code === 'CIRCULAR',
    );
    if (hard) throw new BadRequestException(hard.message);
  }

  async createPreparation(
    branchId: string,
    userId: string,
    dto: PreparationDto,
  ) {
    await this.validatePrepLines(branchId, null, dto);
    try {
      const outputId = await this.prisma.$transaction(async (tx) => {
        const ing = await tx.ingredient.create({
          data: {
            branchId,
            name: dto.name,
            unit: dto.unit,
            kind: 'PREPARED',
            costMethod: 'RECIPE',
          },
        });
        await tx.preparation.create({
          data: {
            branchId,
            outputIngredientId: ing.id,
            batchOutputQty: dto.batchOutputQty,
            overheads: dto.overheads,
            lines: {
              create: dto.lines.map((l) => ({
                ingredientId: l.ingredientId,
                quantity: l.quantity,
                unit: l.unit ?? null,
              })),
            },
          },
        });
        return ing.id;
      });
      await this.audit.record({
        userId,
        action: 'preparation.create',
        entity: 'Ingredient',
        entityId: outputId,
        metadata: { name: dto.name },
      });
      return this.getPreparation(branchId, outputId);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'An ingredient or preparation with that name already exists',
        );
      }
      throw e;
    }
  }

  async updatePreparation(
    branchId: string,
    userId: string,
    outputId: string,
    dto: PreparationDto,
  ) {
    const p = await this.prisma.preparation.findFirst({
      where: { branchId, outputIngredientId: outputId },
      include: { outputIngredient: true },
    });
    if (!p) throw new NotFoundException('Preparation not found');
    if (dto.baseVersion !== undefined && dto.baseVersion !== p.version) {
      throw new CostingConflict(
        'This preparation was changed by someone else after you opened it.',
        await this.getPreparation(branchId, outputId),
      );
    }
    if (dto.unit !== p.outputIngredient.unit) {
      const used =
        (await this.prisma.recipeIngredient.count({
          where: { ingredientId: outputId },
        })) +
        (await this.prisma.preparationLine.count({
          where: { ingredientId: outputId },
        })) +
        (await this.prisma.modifierIngredient.count({
          where: { ingredientId: outputId },
        }));
      if (used > 0 || n(p.outputIngredient.currentStock) !== 0) {
        throw new BadRequestException(
          'The unit cannot change while this preparation is in stock or used in recipes',
        );
      }
    }
    await this.validatePrepLines(branchId, outputId, dto);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.ingredient.update({
          where: { id: outputId },
          data: { name: dto.name, unit: dto.unit },
        });
        await tx.preparationLine.deleteMany({ where: { preparationId: p.id } });
        await tx.preparation.update({
          where: { id: p.id },
          data: {
            batchOutputQty: dto.batchOutputQty,
            overheads: dto.overheads,
            version: { increment: 1 },
            lines: {
              create: dto.lines.map((l) => ({
                ingredientId: l.ingredientId,
                quantity: l.quantity,
                unit: l.unit ?? null,
              })),
            },
          },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'An ingredient or preparation with that name already exists',
        );
      }
      throw e;
    }
    await this.audit.record({
      userId,
      action: 'preparation.update',
      entity: 'Ingredient',
      entityId: outputId,
      metadata: { name: dto.name },
    });
    return this.getPreparation(branchId, outputId);
  }

  async deletePreparation(branchId: string, userId: string, outputId: string) {
    const p = await this.prisma.preparation.findFirst({
      where: { branchId, outputIngredientId: outputId },
    });
    if (!p) throw new NotFoundException('Preparation not found');
    const used =
      (await this.prisma.recipeIngredient.count({
        where: { ingredientId: outputId },
      })) +
      (await this.prisma.preparationLine.count({
        where: { ingredientId: outputId },
      })) +
      (await this.prisma.modifierIngredient.count({
        where: { ingredientId: outputId },
      })) +
      (await this.prisma.menuItem.count({
        where: { stockIngredientId: outputId },
      }));
    if (used > 0)
      throw new BadRequestException(
        'It is used in a recipe or sold as a stock item - remove it there first',
      );
    const runs = await this.prisma.productionRun.count({
      where: { preparationId: p.id },
    });
    if (runs > 0)
      throw new BadRequestException(
        'It has production history - mark the ingredient inactive instead',
      );
    await this.prisma.ingredient.delete({ where: { id: outputId } });
    await this.audit.record({
      userId,
      action: 'preparation.delete',
      entity: 'Ingredient',
      entityId: outputId,
    });
    return { ok: true };
  }

  /**
   * Cooks `batches` batches: consumes the raw ingredients now and receives the finished stock at
   * the cost actually consumed (FIFO batch costs, yield already inside the raw quantities), plus
   * overheads. Selling the finished item later consumes this stock only - never the raw
   * ingredients again. The idempotency key makes a retried or offline-synced run harmless.
   */
  async produce(
    branchId: string,
    userId: string,
    outputId: string,
    dto: ProductionRunDto,
  ) {
    const prep = await this.prisma.preparation.findFirst({
      where: { branchId, outputIngredientId: outputId },
      include: { lines: true, outputIngredient: true },
    });
    if (!prep) throw new NotFoundException('Preparation not found');

    const prior = await this.prisma.productionRun.findUnique({
      where: {
        branchId_idempotencyKey: {
          branchId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
    });
    if (prior)
      return {
        duplicate: true,
        run: this.runView(prior),
        shortages: [] as string[],
      };

    const ingredients = await this.calc.loadIngredients(this.prisma, branchId);
    const recipe = ingredients.get(outputId)?.preparation;
    if (!recipe) throw new NotFoundException('Preparation not found');
    const outputQty = round3(recipe.batchOutputQty * dto.batches);
    const { needs, issues } = stockNeedsForPortions(
      recipe,
      ingredients,
      outputQty,
    );
    const blocking = issues.find(
      (i) =>
        i.code === 'INCOMPATIBLE_UNIT' ||
        i.code === 'INVALID_QUANTITY' ||
        i.code === 'ZERO_OUTPUT',
    );
    if (blocking) throw new BadRequestException(blocking.message);
    const overheadTotal = this.overheadTotal(
      recipe.overheads ?? [],
      outputQty,
      dto.batches,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Claim the key first: a concurrent duplicate loses on the unique index and rolls back.
        const run = await tx.productionRun.create({
          data: {
            branchId,
            preparationId: prep.id,
            idempotencyKey: dto.idempotencyKey,
            batches: dto.batches,
            outputQty,
            ingredientCost: 0,
            overheadCost: 0,
            totalCost: 0,
            unitCost: 0,
            note: dto.note,
            createdById: userId,
          },
        });
        const shortages: string[] = [];
        let ingredientCost = 0;
        for (const need of needs) {
          if (need.rawStockQty <= 0) continue;
          const ing = await tx.ingredient.findUniqueOrThrow({
            where: { id: need.ingredientId },
          });
          if (n(ing.currentStock) < need.rawStockQty) shortages.push(ing.name);
          const portions = await this.stock.consumeStock(
            tx,
            branchId,
            need.ingredientId,
            round3(need.rawStockQty),
            {
              type: 'CONSUMPTION',
              note: `Production: ${prep.outputIngredient.name}`,
              userId,
              allowNegative: true,
            },
          );
          // Real batch costs win. Stock with no receipt behind it (opening balance, manual-cost
          // ingredient) has no recorded cost, so it is valued at the ingredient's effective cost -
          // never at zero, which would make the finished stock look free.
          const fallback =
            effectiveUnitCost(
              ingredients.get(need.ingredientId) as CostIngredient,
              ingredients,
            ).rawPerStockUnit ?? 0;
          ingredientCost += portions.reduce(
            (s, p) => s + p.quantity * (p.unitCost > 0 ? p.unitCost : fallback),
            0,
          );
        }
        const total = ingredientCost + overheadTotal;
        const unitCost = outputQty > 0 ? total / outputQty : 0;

        const out = await tx.ingredient.findUniqueOrThrow({
          where: { id: outputId },
        });
        await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${outputId} FOR UPDATE`;
        const batch = await tx.stockBatch.create({
          data: {
            branchId,
            ingredientId: outputId,
            batchNumber: `PR-${run.id.slice(-6).toUpperCase()}`,
            quantityReceived: outputQty,
            quantityRemaining: outputQty,
            unitCost: round4(unitCost),
          },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: outputId,
            batchId: batch.id,
            type: 'PRODUCTION',
            quantity: outputQty,
            note: `Production run ${run.id}`,
            createdById: userId,
          },
        });
        const oldStock = Math.max(0, n(out.currentStock));
        const newStock = round3(n(out.currentStock) + outputQty);
        const denom = oldStock + outputQty;
        const newCost =
          denom > 0
            ? round4(
                (oldStock * n(out.costPerUnit) + outputQty * unitCost) / denom,
              )
            : round4(unitCost);
        await tx.ingredient.update({
          where: { id: outputId },
          data: { currentStock: newStock, costPerUnit: newCost },
        });
        const done = await tx.productionRun.update({
          where: { id: run.id },
          data: {
            ingredientCost: round4(ingredientCost),
            overheadCost: round4(overheadTotal),
            totalCost: round4(total),
            unitCost: round4(unitCost),
          },
        });
        return { duplicate: false, run: this.runView(done), shortages };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const again = await this.prisma.productionRun.findUnique({
          where: {
            branchId_idempotencyKey: {
              branchId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (again)
          return {
            duplicate: true,
            run: this.runView(again),
            shortages: [] as string[],
          };
      }
      throw e;
    }
  }

  private overheadTotal(
    overheads: readonly Overhead[],
    outputQty: number,
    batches: number,
  ): number {
    let t = 0;
    for (const o of overheads) {
      if (!(o.amount > 0)) continue;
      t +=
        o.basis === 'PER_PORTION' ? o.amount * outputQty : o.amount * batches;
    }
    return t;
  }

  private runView(r: {
    id: string;
    batches: unknown;
    outputQty: unknown;
    ingredientCost: unknown;
    overheadCost: unknown;
    totalCost: unknown;
    unitCost: unknown;
    note: string | null;
    createdAt: Date;
    idempotencyKey: string;
  }) {
    return {
      id: r.id,
      idempotencyKey: r.idempotencyKey,
      batches: n(r.batches),
      outputQty: n(r.outputQty),
      ingredientCost: n(r.ingredientCost),
      overheadCost: n(r.overheadCost),
      totalCost: n(r.totalCost),
      unitCost: n(r.unitCost),
      note: r.note,
      createdAt: r.createdAt,
    };
  }

  // --- Offline bundle for the phone ------------------------------------------------

  /** Compact copy of everything costing needs, so the phone computes the same figures offline. */
  async bundle(branchId: string) {
    const taxMode = await this.branchTax(branchId);
    const [ings, items, mods] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { branchId, isActive: true },
        include: { preparation: { include: { lines: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.menuItem.findMany({
        where: { branchId, isActive: true, isCombo: false },
        include: { costing: true, recipeLines: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.modifierIngredient.findMany({
        where: { modifier: { group: { branchId } } },
      }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      taxMode,
      ingredients: ings.map((i) => ({
        ...toCostIngredient(i),
        kind: i.kind,
        currentStock: n(i.currentStock),
        version: i.version,
      })),
      items: items.map((m) => ({
        menuItemId: m.id,
        name: m.name,
        price: n(m.price),
        halfPrice: m.halfPrice == null ? null : n(m.halfPrice),
        taxRatePercent: n(m.taxRatePercent),
        inventoryTracking: m.inventoryTracking,
        stockIngredientId: m.stockIngredientId,
        stockQuantityPerSale: n(m.stockQuantityPerSale),
        version: m.costing?.version ?? 0,
        batchOutputQty: m.costing ? n(m.costing.batchOutputQty) : 1,
        overheads:
          m.costing && Array.isArray(m.costing.overheads)
            ? m.costing.overheads
            : [],
        halfPortionRatio: m.costing ? n(m.costing.halfPortionRatio) : 0.5,
        targetMarginPercent:
          m.costing?.targetMarginPercent == null
            ? null
            : n(m.costing.targetMarginPercent),
        targetMarkupPercent:
          m.costing?.targetMarkupPercent == null
            ? null
            : n(m.costing.targetMarkupPercent),
        alertDropPoints: m.costing ? n(m.costing.alertDropPoints) : 5,
        baselineCost:
          m.costing?.baselineCost == null ? null : n(m.costing.baselineCost),
        lines: m.recipeLines.map((l) => ({
          ingredientId: l.ingredientId,
          quantity: n(l.quantity),
          unit: l.unit,
        })),
      })),
      modifiers: mods.map((x) => ({
        modifierId: x.modifierId,
        ingredientId: x.ingredientId,
        quantity: n(x.quantity),
        unit: x.unit,
      })),
    };
  }
}
