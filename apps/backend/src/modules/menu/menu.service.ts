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
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

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

  createItem(branchId: string, dto: MenuItemDto) {
    const { modifierGroupIds, ...rest } = dto;
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

  async updateItem(branchId: string, id: string, dto: Partial<MenuItemDto>) {
    await this.getItem(branchId, id);
    const { modifierGroupIds, ...rest } = dto;

    return this.prisma.$transaction(async (tx) => {
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
  }

  async deleteItem(branchId: string, id: string) {
    await this.getItem(branchId, id);
    await this.prisma.menuItem.delete({ where: { id } });
    return { ok: true };
  }

  // --- Modifier groups --------------------------------------------------------

  listModifierGroups() {
    return this.prisma.modifierGroup.findMany({ include: { modifiers: true } });
  }

  createModifierGroup(dto: ModifierGroupDto) {
    const { modifiers, ...rest } = dto;
    return this.prisma.modifierGroup.create({
      data: { ...rest, modifiers: { create: modifiers } },
      include: { modifiers: true },
    });
  }

  async updateModifierGroup(id: string, dto: Partial<ModifierGroupDto>) {
    const group = await this.prisma.modifierGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Modifier group not found');

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

  async deleteModifierGroup(id: string) {
    const group = await this.prisma.modifierGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Modifier group not found');
    await this.prisma.modifierGroup.delete({ where: { id } });
    return { ok: true };
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

  getComboComponents(comboItemId: string) {
    return this.prisma.comboComponent.findMany({
      where: { comboItemId },
      include: {
        componentItem: { select: { id: true, name: true, price: true } },
      },
    });
  }
}
