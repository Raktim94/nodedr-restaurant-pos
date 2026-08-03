import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, StockMovementType } from '@prisma/client';
import type { StockAdjustmentDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { round3 } from '../../common/money';

type Tx = Prisma.TransactionClient;

export interface StockConsumptionPortion {
  batchId: string | null;
  quantity: number;
  unitCost: number;
}

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

  // Shared FIFO consumption core — draws from the oldest StockBatch first,
  // logs one StockMovement per batch touched (each carrying that batch's
  // own cost), and updates Ingredient.currentStock. Used by both waste
  // logging (blocks over-consumption) and order-checkout ingredient
  // deduction (allows going negative — see allowNegative below).
  //
  // Takes the caller's own transaction client rather than opening one
  // itself, so it composes into a larger transaction (order checkout) as
  // cleanly as it runs standalone (waste logging) — the caller owns the
  // atomicity boundary. Ingredient and batches are both read fresh via
  // `tx` as the FIRST thing this does, not from a pre-transaction snapshot
  // the caller might be holding — narrows the concurrent-request race on
  // a shared ingredient's stock to the transaction's own duration, the
  // same discipline `orders.service.ts` already applies to loyalty-point
  // redemption (re-read the mutable balance inside the transaction, not
  // before it).
  async consumeStock(
    tx: Tx,
    branchId: string,
    ingredientId: string,
    quantity: number,
    opts: {
      type: StockMovementType;
      note?: string;
      userId: string;
      allowNegative?: boolean;
    },
  ): Promise<StockConsumptionPortion[]> {
    const ingredient = await tx.ingredient.findFirst({
      where: { id: ingredientId, branchId },
    });
    if (!ingredient) throw new NotFoundException('Ingredient not found');

    const batches = await tx.stockBatch.findMany({
      where: { branchId, ingredientId, quantityRemaining: { gt: 0 } },
      orderBy: { receivedAt: 'asc' },
    });

    const availableFromBatches = batches.reduce(
      (sum, b) => sum + Number(b.quantityRemaining),
      0,
    );
    const available =
      batches.length > 0
        ? availableFromBatches
        : Number(ingredient.currentStock);

    if (quantity > available && !opts.allowNegative) {
      throw new BadRequestException(
        `Cannot consume ${quantity} ${ingredient.unit} of ${ingredient.name} — only ${available} in stock`,
      );
    }

    const portions: StockConsumptionPortion[] = [];
    let remaining = quantity;

    for (const batch of batches) {
      if (remaining <= 0) break;
      const consumeQty = Math.min(remaining, Number(batch.quantityRemaining));

      await tx.stockBatch.update({
        where: { id: batch.id },
        data: {
          quantityRemaining: round3(
            Number(batch.quantityRemaining) - consumeQty,
          ),
        },
      });
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId,
          batchId: batch.id,
          type: opts.type,
          quantity: -consumeQty,
          note: opts.note,
          createdById: opts.userId,
        },
      });
      portions.push({
        batchId: batch.id,
        quantity: consumeQty,
        unitCost: Number(batch.unitCost),
      });
      remaining = round3(remaining - consumeQty);
    }

    if (remaining > 0) {
      // Either no batch history at all, or (allowNegative only) demand
      // exceeded every batch on hand — book the rest against the
      // ingredient directly at its current weighted-average cost.
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId,
          type: opts.type,
          quantity: -remaining,
          note: opts.note,
          createdById: opts.userId,
        },
      });
      portions.push({
        batchId: null,
        quantity: remaining,
        unitCost: Number(ingredient.costPerUnit),
      });
    }

    await tx.ingredient.update({
      where: { id: ingredientId },
      data: {
        currentStock: round3(Number(ingredient.currentStock) - quantity),
      },
    });

    return portions;
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
    return this.prisma.$transaction(async (tx) => {
      const ingredient = await tx.ingredient.findFirst({
        where: { id: ingredientId, branchId },
      });
      if (!ingredient) throw new NotFoundException('Ingredient not found');

      const newStock = round3(Number(ingredient.currentStock) + dto.quantity);
      if (newStock < 0) {
        throw new BadRequestException('Adjustment would take stock below zero');
      }

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
