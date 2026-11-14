import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  MenuCategoryDto,
  MenuItemDto,
  ModifierGroupDto,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

// Options that are still on the menu. A removed option that past orders used is kept (hidden), not deleted.
const ACTIVE_MODIFIERS = {
  modifiers: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  // How many menu items use the group, so the menu screen can warn that editing a shared group changes them all.
  _count: { select: { menuItems: true } },
} as const;

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Categories ---------------------------------------------------------

  listCategories(branchId: string) {
    return this.prisma.menuCategory.findMany({
      where: { branchId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { items: true } } },
    });
  }

  createCategory(branchId: string, dto: MenuCategoryDto) {
    return this.prisma.menuCategory.create({ data: { ...dto, branchId } });
  }

  async updateCategory(
    branchId: string,
    id: string,
    dto: Partial<MenuCategoryDto>,
  ) {
    await this.assertCategoryInBranch(branchId, id);
    return this.prisma.menuCategory.update({ where: { id }, data: dto });
  }

  async deleteCategory(branchId: string, id: string) {
    await this.assertCategoryInBranch(branchId, id);
    await this.prisma.menuCategory.delete({ where: { id } });
    return { ok: true };
  }

  private async assertCategoryInBranch(branchId: string, id: string) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id, branchId },
    });
    if (!category) throw new NotFoundException('Category not found');
  }

  // --- Kitchen stations -----------------------------------------------------

  listStations(branchId: string) {
    return this.prisma.kitchenStation.findMany({ where: { branchId } });
  }

  createStation(branchId: string, name: string, printerName?: string) {
    return this.prisma.kitchenStation.create({
      data: { branchId, name, printerName },
    });
  }

  // --- Menu items -----------------------------------------------------------

  listItems(branchId: string, categoryId?: string) {
    return this.prisma.menuItem.findMany({
      where: { branchId, ...(categoryId ? { categoryId } : {}) },
      orderBy: { sortOrder: 'asc' },
      include: {
        category: true,
        station: true,
        modifierGroups: {
          include: { modifierGroup: { include: ACTIVE_MODIFIERS } },
        },
      },
    });
  }

  async getItem(branchId: string, id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, branchId },
      include: {
        modifierGroups: {
          include: { modifierGroup: { include: ACTIVE_MODIFIERS } },
        },
      },
    });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  async createItem(branchId: string, dto: MenuItemDto) {
    const { modifierGroupIds, ...rest } = dto;
    await this.assertModifierGroupsInBranch(branchId, modifierGroupIds);
    return this.prisma.menuItem.create({
      data: {
        ...rest,
        branchId,
        modifierGroups: {
          create: modifierGroupIds.map((modifierGroupId, index) => ({
            modifierGroupId,
            sortOrder: index,
          })),
        },
      },
      include: { modifierGroups: { include: { modifierGroup: true } } },
    });
  }

  async updateItem(
    branchId: string,
    id: string,
    userId: string,
    dto: Partial<MenuItemDto>,
  ) {
    const existing = await this.getItem(branchId, id);
    const { modifierGroupIds, ...rest } = dto;
    if (modifierGroupIds) {
      await this.assertModifierGroupsInBranch(branchId, modifierGroupIds);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (modifierGroupIds) {
        await tx.menuItemModifierGroup.deleteMany({
          where: { menuItemId: id },
        });
        await tx.menuItemModifierGroup.createMany({
          data: modifierGroupIds.map((modifierGroupId, index) => ({
            menuItemId: id,
            modifierGroupId,
            sortOrder: index,
          })),
        });
      }
      return tx.menuItem.update({ where: { id }, data: rest });
    });

    // Price is the single most owner-relevant field here, so it's logged
    // explicitly (before → after) in addition to the raw change set —
    // everything else in `rest` (name, availability, dietary flags, ...)
    // still shows up via `changes`.
    await this.audit.record({
      userId,
      action: 'menu_item.updated',
      entity: 'MenuItem',
      entityId: id,
      metadata: {
        name: updated.name,
        priceBefore: Number(existing.price),
        priceAfter: Number(updated.price),
        changes: rest,
      },
    });

    return updated;
  }

  /**
   * Raise or lower every dish price by a percentage (negative = cheaper).
   * `preview` returns what would change without writing anything. Paid and
   * open bills keep the price they were rung up at (order lines snapshot it).
   */
  async bulkPriceChange(
    branchId: string,
    userId: string,
    input: {
      percent: number;
      categoryId?: string;
      roundToWhole: boolean;
      preview: boolean;
    },
  ) {
    const { percent, categoryId, roundToWhole, preview } = input;
    const items = await this.prisma.menuItem.findMany({
      where: { branchId, ...(categoryId ? { categoryId } : {}) },
      select: { id: true, name: true, price: true, halfPrice: true },
    });
    const move = (v: number) => {
      const next = Math.max(0, v * (1 + percent / 100));
      return roundToWhole ? Math.round(next) : Math.round(next * 100) / 100;
    };
    const changes = items.map((i) => ({
      id: i.id,
      name: i.name,
      before: Number(i.price),
      after: move(Number(i.price)),
      halfBefore: i.halfPrice == null ? null : Number(i.halfPrice),
      halfAfter: i.halfPrice == null ? null : move(Number(i.halfPrice)),
    }));
    const changed = changes.filter(
      (c) => c.before !== c.after || c.halfBefore !== c.halfAfter,
    );
    if (!preview && changed.length > 0) {
      await this.prisma.$transaction(
        changed.map((c) =>
          this.prisma.menuItem.update({
            where: { id: c.id },
            data: {
              price: c.after,
              ...(c.halfAfter != null ? { halfPrice: c.halfAfter } : {}),
            },
          }),
        ),
      );
      await this.audit.record({
        userId,
        action: 'menu_item.bulk_price_changed',
        entity: 'MenuItem',
        entityId: branchId,
        metadata: {
          percent,
          categoryId: categoryId ?? null,
          roundToWhole,
          count: changed.length,
        },
      });
    }
    return {
      applied: !preview,
      count: changed.length,
      total: items.length,
      sample: changed
        .slice(0, 5)
        .map((c) => ({ name: c.name, before: c.before, after: c.after })),
    };
  }

  private async assertModifierGroupsInBranch(
    branchId: string,
    modifierGroupIds: string[],
  ) {
    if (modifierGroupIds.length === 0) return;
    const count = await this.prisma.modifierGroup.count({
      where: { id: { in: modifierGroupIds }, branchId },
    });
    if (count !== new Set(modifierGroupIds).size) {
      throw new BadRequestException(
        'One or more modifier groups are invalid for this branch',
      );
    }
  }

  async deleteItem(branchId: string, id: string) {
    await this.getItem(branchId, id);
    await this.prisma.menuItem.delete({ where: { id } });
    return { ok: true };
  }

  // --- Modifier groups --------------------------------------------------------

  listModifierGroups(branchId: string) {
    return this.prisma.modifierGroup.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
      include: ACTIVE_MODIFIERS,
    });
  }

  createModifierGroup(branchId: string, dto: ModifierGroupDto) {
    const { modifiers, ...rest } = dto;
    this.assertGroupShape(rest);
    return this.prisma.modifierGroup.create({
      data: {
        ...rest,
        branchId,
        // A new group never takes ids from the client; order is the order given.
        modifiers: {
          create: modifiers.map((m, i) => ({
            name: m.name,
            priceAdjustment: m.priceAdjustment,
            taxRatePercent: m.taxRatePercent,
            kitchenNote: m.kitchenNote,
            isDefault: m.isDefault,
            sortOrder: i,
          })),
        },
      },
      include: ACTIVE_MODIFIERS,
    });
  }

  /**
   * Edit a group IN PLACE. Options sent with an id are updated (so past orders keep pointing at them), options without one
   * are added, and options left out are removed: deleted if nothing ever used them, otherwise hidden (isActive false),
   * because order history references them. The old version deleted and re-created every option, which failed as soon as
   * any option had ever been ordered and dropped each option's stock links.
   */
  async updateModifierGroup(
    branchId: string,
    id: string,
    dto: Partial<ModifierGroupDto>,
  ) {
    await this.assertModifierGroupInBranch(branchId, id);

    const { modifiers, ...rest } = dto;
    if (Object.keys(rest).length) {
      const current = await this.prisma.modifierGroup.findUniqueOrThrow({
        where: { id },
      });
      this.assertGroupShape({ ...current, ...rest });
    }
    return this.prisma.$transaction(async (tx) => {
      if (modifiers) {
        const current = await tx.modifier.findMany({
          where: { groupId: id, isActive: true },
        });
        const known = new Set(current.map((m) => m.id));
        for (const m of modifiers) {
          if (m.id && !known.has(m.id))
            throw new BadRequestException(
              'One of those options does not belong to this group',
            );
        }
        const keep = new Set(modifiers.flatMap((m) => (m.id ? [m.id] : [])));
        for (const [i, m] of modifiers.entries()) {
          const { id: optionId, ...data } = m;
          if (optionId)
            await tx.modifier.update({
              where: { id: optionId },
              data: { ...data, sortOrder: i },
            });
          else
            await tx.modifier.create({
              data: { ...data, sortOrder: i, groupId: id },
            });
        }
        for (const gone of current.filter((m) => !keep.has(m.id))) {
          const used = await tx.orderItemModifier.count({
            where: { modifierId: gone.id },
          });
          if (used > 0)
            await tx.modifier.update({
              where: { id: gone.id },
              data: { isActive: false, isDefault: false },
            });
          else await tx.modifier.delete({ where: { id: gone.id } });
        }
      }
      return tx.modifierGroup.update({
        where: { id },
        data: rest,
        include: ACTIVE_MODIFIERS,
      });
    });
  }

  async deleteModifierGroup(branchId: string, id: string) {
    await this.assertModifierGroupInBranch(branchId, id);
    const used = await this.prisma.orderItemModifier.count({
      where: { modifier: { groupId: id } },
    });
    if (used > 0) {
      throw new ConflictException(
        'This option group has been ordered before, so it is kept for the order history. Remove it from the menu items instead.',
      );
    }
    await this.prisma.modifierGroup.delete({ where: { id } });
    return { ok: true };
  }

  /** "Choose up to" must be at least "must choose": a group nobody can satisfy would block every order of the item. */
  private assertGroupShape(g: {
    minSelect?: number;
    maxSelect?: number;
    isRequired?: boolean;
  }) {
    const min = g.isRequired
      ? Math.max(1, g.minSelect ?? 0)
      : (g.minSelect ?? 0);
    if ((g.maxSelect ?? 1) < min) {
      throw new BadRequestException(
        '"Choose up to" cannot be less than the number the customer must choose',
      );
    }
  }

  private async assertModifierGroupInBranch(branchId: string, id: string) {
    const group = await this.prisma.modifierGroup.findFirst({
      where: { id, branchId },
    });
    if (!group) throw new NotFoundException('Modifier group not found');
  }

  // --- Combo meals -----------------------------------------------------------

  async setComboComponents(
    branchId: string,
    comboItemId: string,
    components: { componentItemId: string; quantity: number }[],
  ) {
    await this.getItem(branchId, comboItemId);
    if (components.some((c) => c.componentItemId === comboItemId)) {
      throw new BadRequestException(
        'A combo cannot include itself as a component',
      );
    }
    const componentIds = components.map((c) => c.componentItemId);
    if (componentIds.length > 0) {
      const count = await this.prisma.menuItem.count({
        where: { id: { in: componentIds }, branchId },
      });
      if (count !== new Set(componentIds).size) {
        throw new BadRequestException(
          'One or more combo components are invalid for this branch',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.comboComponent.deleteMany({ where: { comboItemId } });
      if (components.length > 0) {
        await tx.comboComponent.createMany({
          data: components.map((c) => ({ comboItemId, ...c })),
        });
      }
      await tx.menuItem.update({
        where: { id: comboItemId },
        data: { isCombo: components.length > 0 },
      });
      return tx.comboComponent.findMany({
        where: { comboItemId },
        include: {
          componentItem: { select: { id: true, name: true, price: true } },
        },
      });
    });
  }

  async getComboComponents(branchId: string, comboItemId: string) {
    await this.getItem(branchId, comboItemId);
    return this.prisma.comboComponent.findMany({
      where: { comboItemId },
      include: {
        componentItem: { select: { id: true, name: true, price: true } },
      },
    });
  }
}
