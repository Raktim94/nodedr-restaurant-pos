import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  JournalAdjustmentDto,
  StockReceiptDto,
  StockTakeDto,
} from '@nodedr-restaurant/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toCsv } from '../reports/csv';
import { StockService } from './stock.service';
import { toBaseQuantity } from './units';

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
      const ing = await tx.ingredient.findFirst({
        where: { id: dto.ingredientId, branchId },
      });
      if (!ing) throw new NotFoundException('Stock item not found');
      const qty = toBaseQuantity(
        dto.quantity,
        dto.unit,
        ing.unit,
        ing.conversions,
        ing.name,
      );
      const supplier = dto.supplierId
        ? await tx.supplier.findFirst({
            where: { id: dto.supplierId, branchId },
            select: { name: true },
          })
        : null;
      if (dto.supplierId && !supplier)
        throw new BadRequestException('Supplier not found');
      const rate =
        dto.unitCost !== undefined && dto.unitCost !== ''
          ? Dec(dto.unitCost)
          : null;
      if (rate && (!rate.isFinite() || rate.isNegative()))
        throw new BadRequestException('The cost must be zero or more');
      const batch = await tx.stockBatch.create({
        data: {
          branchId,
          ingredientId: ing.id,
          batchNumber: dto.idempotencyKey
            ? `K:${dto.idempotencyKey}`
            : dto.reference || 'RCV',
          quantityReceived: qty,
          quantityRemaining: qty,
          unitCost: rate ?? 0,
          expiryDate: dto.expiryDate,
          receivedAt: dto.receivedAt ?? new Date(),
        },
      });
      const note = [
        supplier?.name && `From ${supplier.name}`,
        dto.reference && `Ref ${dto.reference}`,
        dto.location && `At ${dto.location}`,
        dto.note,
      ]
        .filter(Boolean)
        .join(' · ');
      await tx.stockMovement.create({
        data: {
          branchId,
          ingredientId: ing.id,
          batchId: batch.id,
          type: 'RECEIPT',
          quantity: qty,
          note: note || 'Stock received',
          createdById: userId,
          deviceId: dto.deviceId,
        },
      });
      const oldStock = Dec(ing.currentStock);
      const avg = rate
        ? oldStock.lte(0)
          ? rate
          : oldStock
              .mul(ing.costPerUnit)
              .plus(qty.mul(rate))
              .div(oldStock.plus(qty))
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
        : null;
      await tx.ingredient.update({
        where: { id: ing.id },
        data: {
          currentStock: oldStock.plus(qty),
          ...(avg ? { costPerUnit: avg } : {}),
        },
      });
      await this.audit.record({
        userId,
        action: 'stock.receive',
        entity: 'Ingredient',
        entityId: ing.id,
        metadata: { qty: qty.toString(), reference: dto.reference },
      });
      return tx.stockBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { stockMovements: true },
      });
    });
  }

  // ---- stock take (the shelf count) ------------------------------------------------------

  async stockTake(branchId: string, userId: string, dto: StockTakeDto) {
    if (dto.idempotencyKey) {
      const dup = await this.prisma.stockTake.findUnique({
        where: {
          branchId_idempotencyKey: {
            branchId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
      });
      if (dup) return dup;
    }
    return this.prisma.$transaction(async (tx) => {
      const ids = [...new Set(dto.lines.map((l) => l.ingredientId))].sort();
      if (ids.length !== dto.lines.length)
        throw new BadRequestException('An item is on the sheet twice');
      for (const id of ids)
        await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${id} FOR UPDATE`;
      const items = await tx.ingredient.findMany({
        where: { id: { in: ids }, branchId },
      });
      if (items.length !== ids.length)
        throw new NotFoundException('A counted item was not found');
      const byId = new Map(items.map((i) => [i.id, i]));
      // When the sheet is for a place the restaurant has set up, the count is compared with what was
      // recorded IN that place, and the place's level is set to the count; the item's total moves by the difference.
      const place = dto.area
        ? await tx.stockLocation.findFirst({
            where: { branchId, name: dto.area, isActive: true },
          })
        : null;
      const placeLevels = place
        ? new Map(
            (
              await tx.stockLevel.findMany({
                where: { locationId: place.id, ingredientId: { in: ids } },
              })
            ).map((l) => [l.ingredientId, l.quantity]),
          )
        : null;
      const take = await tx.stockTake.create({
        data: {
          branchId,
          takenAt: dto.takenAt ?? new Date(),
          area: dto.area,
          note: dto.note,
          idempotencyKey: dto.idempotencyKey,
          deviceId: dto.deviceId,
          createdById: userId,
          lines: [],
        },
      });
      const out: {
        ingredientId: string;
        name: string;
        unit: string;
        expected: string;
        counted: string;
        difference: string;
      }[] = [];
      for (const l of dto.lines) {
        const ing = byId.get(l.ingredientId)!;
        const counted = Dec(l.counted).isZero()
          ? Dec(0)
          : toBaseQuantity(
              l.counted,
              l.unit,
              ing.unit,
              ing.conversions,
              ing.name,
            );
        if (Dec(l.counted).isNegative())
          throw new BadRequestException(
            `${ing.name}: a count cannot be negative`,
          );
        const expected = placeLevels
          ? Dec(placeLevels.get(ing.id) ?? 0)
          : Dec(ing.currentStock);
        const diff = counted.minus(expected);
        out.push({
          ingredientId: ing.id,
          name: ing.name,
          unit: ing.unit,
          expected: expected.toString(),
          counted: counted.toString(),
          difference: diff.toString(),
        });
        if (diff.isZero()) continue;
        if (place)
          await tx.stockLevel.upsert({
            where: {
              ingredientId_locationId: {
                ingredientId: ing.id,
                locationId: place.id,
              },
            },
            create: {
              ingredientId: ing.id,
              locationId: place.id,
              quantity: counted,
            },
            update: { quantity: counted },
          });
        const note = `Stock take: counted ${counted.toString()}, system had ${expected.toString()}${dto.area ? ` (${dto.area})` : ''}`;
        if (diff.isNegative()) {
          await this.stock.consumeStock(tx, branchId, ing.id, diff.abs(), {
            type: 'ADJUSTMENT',
            note,
            userId,
            allowNegative: false,
            refs: { deviceId: dto.deviceId },
          });
        } else {
          const batch = await tx.stockBatch.create({
            data: {
              branchId,
              ingredientId: ing.id,
              batchNumber: 'COUNT',
              quantityReceived: diff,
              quantityRemaining: diff,
              unitCost: 0,
            },
          });
          await tx.stockMovement.create({
            data: {
              branchId,
              ingredientId: ing.id,
              batchId: batch.id,
              type: 'ADJUSTMENT',
              quantity: diff,
              note,
              createdById: userId,
              deviceId: dto.deviceId,
            },
          });
          await tx.ingredient.update({
            where: { id: ing.id },
            data: { currentStock: Dec(ing.currentStock).plus(diff) },
          });
        }
      }
      await this.audit.record({
        userId,
        action: 'stock.take',
        entity: 'StockTake',
        entityId: take.id,
        metadata: {
          items: out.length,
          changed: out.filter((o) => o.difference !== '0').length,
        },
      });
      return tx.stockTake.update({
        where: { id: take.id },
        data: { lines: out },
      });
    });
  }

  listStockTakes(branchId: string) {
    return this.prisma.stockTake.findMany({
      where: { branchId },
      orderBy: { takenAt: 'desc' },
      take: 30,
    });
  }

  // ---- what a kitchen needs to look at every morning ----------------------------------------

  /** Stock that will go off soon (or already has), oldest first, so it is used first. */
  async expiring(branchId: string, days: number) {
    const until = new Date(Date.now() + days * 86_400_000);
    const rows = await this.prisma.stockBatch.findMany({
      where: {
        branchId,
        quantityRemaining: { gt: 0 },
        expiryDate: { not: null, lte: until },
      },
      include: {
        ingredient: {
          select: { id: true, name: true, unit: true, storageLocation: true },
        },
      },
      orderBy: { expiryDate: 'asc' },
      take: 200,
    });
    const now = Date.now();
    return rows.map((b) => ({
      batchId: b.id,
      ingredientId: b.ingredientId,
      name: b.ingredient.name,
      unit: b.ingredient.unit,
      storageLocation: b.ingredient.storageLocation,
      quantity: b.quantityRemaining.toString(),
      expiryDate: b.expiryDate,
      expired: b.expiryDate!.getTime() < now,
      daysLeft: Math.ceil((b.expiryDate!.getTime() - now) / 86_400_000),
    }));
  }

  /** Items at or under their minimum, with how much to buy to get back to the par level. */
  async reorderList(branchId: string) {
    const items = await this.prisma.ingredient.findMany({
      where: { branchId, isActive: true, kind: 'PURCHASED' },
      select: {
        id: true,
        name: true,
        unit: true,
        category: true,
        currentStock: true,
        reorderLevel: true,
        parLevel: true,
        storageLocation: true,
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return items
      .filter(
        (i) =>
          Dec(i.reorderLevel).gt(0) && Dec(i.currentStock).lte(i.reorderLevel),
      )
      .map((i) => {
        const par = i.parLevel ? Dec(i.parLevel) : Dec(i.reorderLevel).mul(2);
        const need = par.minus(i.currentStock);
        return {
          id: i.id,
          name: i.name,
          unit: i.unit,
          category: i.category,
          storageLocation: i.storageLocation,
          inStock: i.currentStock.toString(),
          minimum: i.reorderLevel.toString(),
          par: par.toString(),
          toBuy: (need.isNegative() ? Dec(0) : need).toString(),
        };
      });
  }

  async reorderCsv(branchId: string) {
    const rows = await this.reorderList(branchId);
    return toCsv(
      [
        'Item',
        'Category',
        'Storage',
        'In stock',
        'Minimum',
        'Bring up to',
        'To buy',
        'Unit',
      ],
      rows.map((r) => [
        r.name,
        r.category,
        r.storageLocation,
        r.inStock,
        r.minimum,
        r.par,
        r.toBuy,
        r.unit,
      ]),
    );
  }

  /** Signed correction, reason mandatory, never below zero. */
  async adjust(branchId: string, userId: string, dto: JournalAdjustmentDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${dto.ingredientId} FOR UPDATE`;
      const ing = await tx.ingredient.findFirst({
        where: { id: dto.ingredientId, branchId },
      });
      if (!ing) throw new NotFoundException('Stock item not found');
      const qty = toBaseQuantity(
        dto.quantity,
        dto.unit,
        ing.unit,
        ing.conversions,
        ing.name,
      );
      if (dto.direction === 'REMOVE') {
        await this.stock.consumeStock(tx, branchId, ing.id, qty, {
          type: 'ADJUSTMENT',
          note: dto.reason,
          userId,
          allowNegative: false,
          refs: { deviceId: dto.deviceId },
        });
      } else {
        const batch = await tx.stockBatch.create({
          data: {
            branchId,
            ingredientId: ing.id,
            batchNumber: 'ADJ',
            quantityReceived: qty,
            quantityRemaining: qty,
            unitCost: 0,
          },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: ing.id,
            batchId: batch.id,
            type: 'ADJUSTMENT',
            quantity: qty,
            note: dto.reason,
            createdById: userId,
            deviceId: dto.deviceId,
          },
        });
        await tx.ingredient.update({
          where: { id: ing.id },
          data: { currentStock: Dec(ing.currentStock).plus(qty) },
        });
      }
      await this.audit.record({
        userId,
        action: 'stock.adjust',
        entity: 'Ingredient',
        entityId: ing.id,
        metadata: {
          direction: dto.direction,
          qty: qty.toString(),
          reason: dto.reason,
        },
      });
      return tx.ingredient.findUniqueOrThrow({
        where: { id: ing.id },
        select: { id: true, name: true, unit: true, currentStock: true },
      });
    });
  }

  private where(
    branchId: string,
    f: JournalFilters,
  ): Prisma.StockMovementWhereInput {
    return {
      branchId,
      ...(f.ingredientId ? { ingredientId: f.ingredientId } : {}),
      ...(f.type ? { type: f.type as never } : {}),
      ...(f.productionEntryId
        ? { productionEntryId: f.productionEntryId }
        : {}),
      ...(f.wasteEntryId ? { wasteEntryId: f.wasteEntryId } : {}),
      ...(f.from || f.to
        ? {
            createdAt: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {}),
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
        id: true,
        name: true,
        unit: true,
        kind: true,
        category: true,
        storageLocation: true,
        currentStock: true,
        reorderLevel: true,
        conversions: true,
      },
    });
    return items;
  }

  async exportCsv(branchId: string, f: JournalFilters) {
    const { items } = await this.list(branchId, {
      ...f,
      take: 500,
      cursor: undefined,
    });
    return toCsv(
      [
        'Movement',
        'When',
        'Item',
        'Type',
        'Signed quantity',
        'Unit',
        'By',
        'Production entry',
        'Waste entry',
        'Device',
        'Note',
      ],
      items.map((m) => [
        m.id,
        m.createdAt,
        m.ingredient.name,
        m.type,
        m.quantity.toString(),
        m.ingredient.unit,
        m.createdBy.name,
        m.productionEntryId,
        m.wasteEntryId,
        m.deviceId,
        m.note,
      ]),
    );
  }
}
