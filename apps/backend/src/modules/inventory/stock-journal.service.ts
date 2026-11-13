import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { JournalAdjustmentDto, StockReceiptDto } from '@nodedr-restaurant/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toCsv } from '../reports/csv';
import { StockService } from './stock.service';
import { toBaseQuantity, type StockUnit } from './units';

const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface JournalFilters {
  from?: Date;
  to?: Date;
  ingredientId?: string;
  type?: string;
  productionEntryId?: string;
  wasteEntryId?: string;
  cursor?: string;
  take?: number;
}

// The stock journal is the StockMovement ledger itself, read in one place: every receipt, production
// use, production output, waste, sale, adjustment and reversal, newest first, with who made it and
// which record it belongs to. Rows are only ever appended.
@Injectable()
export class StockJournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  /** Receive raw material: one batch, one RECEIPT movement, balance updated in the same transaction. */
  async receive(branchId: string, userId: string, dto: StockReceiptDto) {
    if (dto.idempotencyKey) {
      const dup = await this.prisma.stockBatch.findFirst({
        where: { branchId, batchNumber: `K:${dto.idempotencyKey}` },
        include: { stockMovements: true },
      });
      if (dup) return dup;
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${dto.ingredientId} FOR UPDATE`;
      const ing = await tx.ingredient.findFirst({ where: { id: dto.ingredientId, branchId } });
      if (!ing) throw new NotFoundException('Stock item not found');
      const qty = toBaseQuantity(dto.quantity, dto.unit as StockUnit, ing.unit as StockUnit, ing.conversions, ing.name);
      const supplier = dto.supplierId
        ? await tx.supplier.findFirst({ where: { id: dto.supplierId, branchId }, select: { name: true } })
        : null;
      if (dto.supplierId && !supplier) throw new BadRequestException('Supplier not found');
      const batch = await tx.stockBatch.create({
        data: {
          branchId, ingredientId: ing.id, batchNumber: dto.idempotencyKey ? `K:${dto.idempotencyKey}` : dto.reference || 'RCV',
          quantityReceived: qty, quantityRemaining: qty, unitCost: 0,
          expiryDate: dto.expiryDate, receivedAt: dto.receivedAt ?? new Date(),
        },
      });
      const note = [supplier?.name && `From ${supplier.name}`, dto.reference && `Ref ${dto.reference}`, dto.location && `At ${dto.location}`, dto.note]
        .filter(Boolean).join(' · ');
      await tx.stockMovement.create({
        data: {
          branchId, ingredientId: ing.id, batchId: batch.id, type: 'RECEIPT', quantity: qty,
          note: note || 'Stock received', createdById: userId, deviceId: dto.deviceId,
        },
      });
      await tx.ingredient.update({ where: { id: ing.id }, data: { currentStock: Dec(ing.currentStock).plus(qty) } });
      await this.audit.record({ userId, action: 'stock.receive', entity: 'Ingredient', entityId: ing.id, metadata: { qty: qty.toString(), reference: dto.reference } });
      return tx.stockBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { stockMovements: true } });
    });
  }

  /** Signed correction, reason mandatory, never below zero. */
  async adjust(branchId: string, userId: string, dto: JournalAdjustmentDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${dto.ingredientId} FOR UPDATE`;
      const ing = await tx.ingredient.findFirst({ where: { id: dto.ingredientId, branchId } });
      if (!ing) throw new NotFoundException('Stock item not found');
      const qty = toBaseQuantity(dto.quantity, dto.unit as StockUnit, ing.unit as StockUnit, ing.conversions, ing.name);
      if (dto.direction === 'REMOVE') {
        await this.stock.consumeStock(tx, branchId, ing.id, qty, {
          type: 'ADJUSTMENT', note: dto.reason, userId, allowNegative: false, refs: { deviceId: dto.deviceId },
        });
      } else {
        const batch = await tx.stockBatch.create({
          data: { branchId, ingredientId: ing.id, batchNumber: 'ADJ', quantityReceived: qty, quantityRemaining: qty, unitCost: 0 },
        });
        await tx.stockMovement.create({
          data: { branchId, ingredientId: ing.id, batchId: batch.id, type: 'ADJUSTMENT', quantity: qty, note: dto.reason, createdById: userId, deviceId: dto.deviceId },
        });
        await tx.ingredient.update({ where: { id: ing.id }, data: { currentStock: Dec(ing.currentStock).plus(qty) } });
      }
      await this.audit.record({ userId, action: 'stock.adjust', entity: 'Ingredient', entityId: ing.id, metadata: { direction: dto.direction, qty: qty.toString(), reason: dto.reason } });
      return tx.ingredient.findUniqueOrThrow({ where: { id: ing.id }, select: { id: true, name: true, unit: true, currentStock: true } });
    });
  }

  private where(branchId: string, f: JournalFilters): Prisma.StockMovementWhereInput {
    return {
      branchId,
      ...(f.ingredientId ? { ingredientId: f.ingredientId } : {}),
      ...(f.type ? { type: f.type as never } : {}),
      ...(f.productionEntryId ? { productionEntryId: f.productionEntryId } : {}),
      ...(f.wasteEntryId ? { wasteEntryId: f.wasteEntryId } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    };
  }

  async list(branchId: string, f: JournalFilters) {
    const take = Math.min(f.take ?? 100, 500);
    const rows = await this.prisma.stockMovement.findMany({
      where: this.where(branchId, f),
      include: {
        ingredient: { select: { id: true, name: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    });
    const more = rows.length > take;
    const page = more ? rows.slice(0, take) : rows;
    return { items: page, nextCursor: more ? page[page.length - 1].id : null };
  }

  /** Stock on hand for every active item: the number the journal's movements add up to. */
  async balances(branchId: string) {
    const items = await this.prisma.ingredient.findMany({
      where: { branchId, isActive: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, unit: true, kind: true, category: true, storageLocation: true,
        currentStock: true, reorderLevel: true, conversions: true,
      },
    });
    return items;
  }

  async exportCsv(branchId: string, f: JournalFilters) {
    const { items } = await this.list(branchId, { ...f, take: 500, cursor: undefined });
    return toCsv(
      ['Movement', 'When', 'Item', 'Type', 'Signed quantity', 'Unit', 'By', 'Production entry', 'Waste entry', 'Device', 'Note'],
      items.map((m) => [
        m.id, m.createdAt, m.ingredient.name, m.type, m.quantity.toString(), m.ingredient.unit,
        m.createdBy.name, m.productionEntryId, m.wasteEntryId, m.deviceId, m.note,
      ]),
    );
  }
}
