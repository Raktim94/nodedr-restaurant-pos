import {
  BadRequestException,
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
          include: { modifierGroup: { include: { modifiers: true } } },
        },
      },
    });
  }

  async getItem(branchId: string, id: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id, branchId },
      include: {
        modifierGroups: {
          include: { modifierGroup: { include: { modifiers: true } } },
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
      include: { modifiers: true },
    });
  }

  createModifierGroup(branchId: string, dto: ModifierGroupDto) {
    const { modifiers, ...rest } = dto;
    return this.prisma.modifierGroup.create({
      data: { ...rest, branchId, modifiers: { create: modifiers } },
      include: { modifiers: true },
    });
  }

  async updateModifierGroup(
    branchId: string,
    id: string,
    dto: Partial<ModifierGroupDto>,
  ) {
    await this.assertModifierGroupInBranch(branchId, id);

    const { modifiers, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (modifiers) {
        await tx.modifier.deleteMany({ where: { groupId: id } });
        await tx.modifier.createMany({
          data: modifiers.map((m) => ({ ...m, groupId: id })),
        });
      }
      return tx.modifierGroup.update({
        where: { id },
        data: rest,
        include: { modifiers: true },
      });
    });
  }

  async deleteModifierGroup(branchId: string, id: string) {
    await this.assertModifierGroupInBranch(branchId, id);
    await this.prisma.modifierGroup.delete({ where: { id } });
    return { ok: true };
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
