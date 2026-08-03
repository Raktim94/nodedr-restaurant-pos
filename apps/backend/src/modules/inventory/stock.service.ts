import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StockAdjustmentDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round3 } from '../../common/money';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  listMovements(branchId: string, ingredientId: string) {
    return this.prisma.stockMovement.findMany({
      where: { branchId, ingredientId },
      include: { createdBy: { select: { id: true, name: true } }, batch: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  listBatches(branchId: string, ingredientId: string) {
    return this.prisma.stockBatch.findMany({
      where: { branchId, ingredientId },
      orderBy: { receivedAt: 'desc' },
    });
  }

  // Manual correction (stocktake variance, data-entry fix) — NOT for
  // receiving stock (use a GRN, which carries cost/batch/supplier info) or
  // wasting stock (use the waste log, which carries a reason). This is the
  // narrow escape hatch for "the physical count doesn't match the system."
  async adjustStock(
    branchId: string,
    userId: string,
    ingredientId: string,
    dto: StockAdjustmentDto,
  ) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id: ingredientId, branchId },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');

    const newStock = round3(Number(ingredient.currentStock) + dto.quantity);
    if (newStock < 0) {
      throw new BadRequestException('Adjustment would take stock below zero');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ingredient.update({
        where: { id: ingredientId },
        data: { currentStock: newStock },
      });
      return tx.stockMovement.create({
        data: {
          branchId,
          ingredientId,
          type: 'ADJUSTMENT',
          quantity: dto.quantity,
          note: dto.note,
          createdById: userId,
        },
      });
    });
  }
}
