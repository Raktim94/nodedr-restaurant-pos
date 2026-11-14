import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProductRecipeDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toBaseQuantity } from './units';

const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// Saved bills of materials. A recipe says what `baseOutputQty` of a finished product takes; filling a voucher scales it
// to the quantity planned. Editing bumps the version; vouchers keep their own snapshot so history never moves.
// Menu-item recipes (the older "deduct on sale" lines) are offered too, labelled MENU, with base output 1 portion
// unless the item has a costing batch size.
@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(
    r: Prisma.ProductRecipeGetPayload<{
      include: {
        lines: {
          include: { ingredient: { select: { name: true; unit: true } } };
        };
        outputIngredient: { select: { name: true; unit: true } };
      };
    }>,
  ) {
    return {
      kind: 'RECIPE' as const,
      id: r.id,
      name: r.name,
      version: r.version,
      isActive: r.isActive,
      notes: r.notes,
      outputIngredientId: r.outputIngredientId,
      outputName: r.outputIngredient.name,
      outputUnit: r.outputIngredient.unit,
      baseOutputQty: r.baseOutputQty.toString(),
      lines: r.lines.map((l) => ({
        ingredientId: l.ingredientId,
        name: l.ingredient.name,
        quantity: l.quantity.toString(),
        unit: l.unit,
      })),
    };
  }

  private include = {
    lines: {
      include: { ingredient: { select: { name: true, unit: true } } },
      orderBy: { id: 'asc' as const },
    },
    outputIngredient: { select: { name: true, unit: true } },
  };

  /** Saved recipes (and legacy menu recipes) for a finished product, or every saved recipe when no product is given. */
  async list(
    branchId: string,
    outputIngredientId?: string,
    includeInactive = false,
  ) {
    const rows = await this.prisma.productRecipe.findMany({
      where: {
        branchId,
        ...(outputIngredientId ? { outputIngredientId } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: this.include,
      orderBy: [{ name: 'asc' }],
    });
    const menu = outputIngredientId
      ? await this.prisma.menuItem.findMany({
          where: {
            branchId,
            stockIngredientId: outputIngredientId,
            recipeLines: { some: {} },
          },
          include: {
            recipeLines: {
              include: { ingredient: { select: { name: true, unit: true } } },
            },
            costing: { select: { batchOutputQty: true, version: true } },
            stockIngredient: { select: { name: true, unit: true } },
          },
        })
      : [];
    return [
      ...rows.map((r) => this.view(r)),
      ...menu.map((m) => ({
        kind: 'MENU' as const,
        id: m.id,
        name: `${m.name} (menu recipe)`,
        version: m.costing?.version ?? 1,
        isActive: true,
        notes: null,
        outputIngredientId: m.stockIngredientId!,
        outputName: m.stockIngredient?.name ?? m.name,
        outputUnit: m.stockIngredient?.unit ?? 'PIECE',
        baseOutputQty: (m.costing?.batchOutputQty ?? Dec(1)).toString(),
        lines: m.recipeLines.map((l) => ({
          ingredientId: l.ingredientId,
          name: l.ingredient.name,
          quantity: l.quantity.toString(),
          unit: l.unit ?? l.ingredient.unit,
        })),
      })),
    ];
  }

  private async check(branchId: string, dto: ProductRecipeDto) {
    const out = await this.prisma.ingredient.findFirst({
      where: { id: dto.outputIngredientId, branchId },
    });
    if (!out) throw new NotFoundException('Finished product not found');
    if (out.kind !== 'PREPARED')
      throw new BadRequestException(
        `${out.name} is a raw material. A recipe is for a finished product.`,
      );
    const base = Dec(dto.baseOutputQty);
    if (!base.isFinite() || base.lte(0))
      throw new BadRequestException('Base output quantity must be above zero');
    const ids = dto.lines.map((l) => l.ingredientId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'An ingredient is listed twice; combine it into one row',
      );
    if (ids.includes(out.id))
      throw new BadRequestException(
        'A product cannot be an ingredient of itself',
      );
    const ings = await this.prisma.ingredient.findMany({
      where: { id: { in: ids }, branchId },
    });
    const byId = new Map(ings.map((i) => [i.id, i]));
    for (const l of dto.lines) {
      const ing = byId.get(l.ingredientId);
      if (!ing)
        throw new NotFoundException(
          'An ingredient on the recipe was not found',
        );
      const q = Dec(l.quantity);
      if (!q.isFinite() || q.lte(0))
        throw new BadRequestException(
          `${ing.name}: quantity must be above zero`,
        );
      toBaseQuantity(q, l.unit, ing.unit, ing.conversions, ing.name); // refuses an unconvertible unit
    }
  }

  async create(branchId: string, userId: string, dto: ProductRecipeDto) {
    await this.check(branchId, dto);
    try {
      const r = await this.prisma.productRecipe.create({
        data: {
          branchId,
          outputIngredientId: dto.outputIngredientId,
          name: dto.name,
          baseOutputQty: Dec(dto.baseOutputQty),
          notes: dto.notes,
          createdById: userId,
          lines: {
            create: dto.lines.map((l) => ({
              ingredientId: l.ingredientId,
              quantity: Dec(l.quantity),
              unit: l.unit,
            })),
          },
        },
        include: this.include,
      });
      await this.audit.record({
        userId,
        action: 'recipe.create',
        entity: 'ProductRecipe',
        entityId: r.id,
        metadata: { name: r.name },
      });
      return this.view(r);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'This product already has a recipe with that name',
        );
      throw e;
    }
  }

  async update(
    branchId: string,
    userId: string,
    id: string,
    dto: ProductRecipeDto,
  ) {
    const cur = await this.prisma.productRecipe.findFirst({
      where: { id, branchId },
    });
    if (!cur) throw new NotFoundException('Recipe not found');
    await this.check(branchId, {
      ...dto,
      outputIngredientId: cur.outputIngredientId,
    });
    const r = await this.prisma.$transaction(async (tx) => {
      await tx.productRecipeLine.deleteMany({ where: { recipeId: id } });
      return tx.productRecipe.update({
        where: { id },
        data: {
          name: dto.name,
          baseOutputQty: Dec(dto.baseOutputQty),
          notes: dto.notes,
          version: { increment: 1 },
          lines: {
            create: dto.lines.map((l) => ({
              ingredientId: l.ingredientId,
              quantity: Dec(l.quantity),
              unit: l.unit,
            })),
          },
        },
        include: this.include,
      });
    });
    await this.audit.record({
      userId,
      action: 'recipe.update',
      entity: 'ProductRecipe',
      entityId: id,
      metadata: { name: r.name, version: r.version },
    });
    return this.view(r);
  }

  async setActive(
    branchId: string,
    userId: string,
    id: string,
    isActive: boolean,
  ) {
    const r = await this.prisma.productRecipe.updateMany({
      where: { id, branchId },
      data: { isActive },
    });
    if (!r.count) throw new NotFoundException('Recipe not found');
    await this.audit.record({
      userId,
      action: isActive ? 'recipe.restore' : 'recipe.retire',
      entity: 'ProductRecipe',
      entityId: id,
    });
    return { ok: true };
  }

  /**
   * Expected ingredient quantities for a planned good output, scaled from the recipe's base output. A starting point:
   * the operator records what was really used. Every unit is converted to the item's stock unit for the comparison.
   */
  async fill(
    branchId: string,
    kind: 'RECIPE' | 'MENU',
    id: string,
    plannedOutput: string,
  ) {
    const planned = Dec(plannedOutput || '0');
    if (!planned.isFinite() || planned.lte(0))
      throw new BadRequestException('Type how many you plan to make first');
    const all =
      kind === 'RECIPE'
        ? await this.prisma.productRecipe
            .findFirst({ where: { id, branchId }, include: this.include })
            .then((r) => (r ? [this.view(r)] : []))
        : await this.list(
            branchId,
            (
              await this.prisma.menuItem.findFirst({
                where: { id, branchId },
                select: { stockIngredientId: true },
              })
            )?.stockIngredientId ?? undefined,
          ).then((l) => l.filter((x) => x.kind === 'MENU' && x.id === id));
    const rec = all[0];
    if (!rec) throw new NotFoundException('That recipe was not found');
    const factor = planned.div(Dec(rec.baseOutputQty));
    const ings = new Map(
      (
        await this.prisma.ingredient.findMany({
          where: { id: { in: rec.lines.map((l) => l.ingredientId) }, branchId },
        })
      ).map((i) => [i.id, i]),
    );
    return {
      recipe: {
        kind: rec.kind,
        id: rec.id,
        name: rec.name,
        version: rec.version,
        baseOutputQty: rec.baseOutputQty,
        outputUnit: rec.outputUnit,
      },
      plannedOutput: planned.toString(),
      lines: rec.lines.map((l) => {
        const ing = ings.get(l.ingredientId);
        return {
          ingredientId: l.ingredientId,
          name: l.name,
          unit: l.unit,
          quantity: Dec(l.quantity).mul(factor).toDecimalPlaces(3).toString(),
          stockUnit: ing?.unit ?? l.unit,
        };
      }),
    };
  }
}
