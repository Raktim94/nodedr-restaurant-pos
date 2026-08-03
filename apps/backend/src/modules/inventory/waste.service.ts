import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WasteLogDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round3 } from '../../common/money';

@Injectable()
export class WasteService {
  constructor(private readonly prisma: PrismaService) {}

  listWasteLogs(branchId: string) {
    return this.prisma.wasteLog.findMany({
      where: { branchId },
      include: {
        ingredient: { select: { id: true, name: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // FIFO consumption: waste is drawn from the oldest StockBatch first. If
  // the request spans more than one batch, we record one WasteLog row per
  // batch touched — each carries that batch's own unitCost, which is the
  // whole point of batch tracking (an accurate cost-of-waste figure, not a
  // blended average that hides which lot actually spoiled).
  async logWaste(branchId: string, userId: string, dto: WasteLogDto) {
    const ingredient = await this.prisma.ingredient.findFirst({
      where: { id: dto.ingredientId, branchId },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');

    const batches = await this.prisma.stockBatch.findMany({
      where: {
        branchId,
        ingredientId: dto.ingredientId,
        quantityRemaining: { gt: 0 },
      },
      orderBy: { receivedAt: 'asc' },
    });

    const availableFromBatches = batches.reduce(
      (sum, b) => sum + Number(b.quantityRemaining),
      0,
    );
    // An ingredient can carry stock with no batch history (e.g. an opening
    // balance set directly, never received via GRN) — fall back to a single
    // batch-less waste entry against the ingredient's cached stock in that
    // case, rather than blocking waste logging entirely.
    const available =
      batches.length > 0
        ? availableFromBatches
        : Number(ingredient.currentStock);
    if (dto.quantity > available) {
      throw new BadRequestException(
        `Cannot waste ${dto.quantity} ${ingredient.unit} — only ${available} in stock`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let remainingToWaste = dto.quantity;
      const createdLogs: Array<Record<string, unknown>> = [];

      for (const batch of batches) {
        if (remainingToWaste <= 0) break;
        const consumeQty = Math.min(
          remainingToWaste,
          Number(batch.quantityRemaining),
        );

        await tx.stockBatch.update({
          where: { id: batch.id },
          data: {
            quantityRemaining: round3(
              Number(batch.quantityRemaining) - consumeQty,
            ),
          },
        });

        const movement = await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: dto.ingredientId,
            batchId: batch.id,
            type: 'WASTE',
            quantity: -consumeQty,
            note: dto.notes,
            createdById: userId,
          },
        });

        const log = await tx.wasteLog.create({
          data: {
            branchId,
            ingredientId: dto.ingredientId,
            batchId: batch.id,
            quantity: consumeQty,
            reason: dto.reason,
            unitCostAtWaste: batch.unitCost,
            notes: dto.notes,
            createdById: userId,
          },
        });
        createdLogs.push({ ...log, movementId: movement.id });

        remainingToWaste = round3(remainingToWaste - consumeQty);
      }

      if (remainingToWaste > 0) {
        // No batch history at all — batch-less waste against the ingredient
        // directly, priced at its current weighted-average cost.
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: dto.ingredientId,
            type: 'WASTE',
            quantity: -remainingToWaste,
            note: dto.notes,
            createdById: userId,
          },
        });
        const log = await tx.wasteLog.create({
          data: {
            branchId,
            ingredientId: dto.ingredientId,
            quantity: remainingToWaste,
            reason: dto.reason,
            unitCostAtWaste: ingredient.costPerUnit,
            notes: dto.notes,
            createdById: userId,
          },
        });
        createdLogs.push(log);
      }

      const newStock = round3(Number(ingredient.currentStock) - dto.quantity);
      await tx.ingredient.update({
        where: { id: dto.ingredientId },
        data: { currentStock: newStock },
      });

      return createdLogs;
    });
  }
}
