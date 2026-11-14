import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WasteEntryDto } from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toCsv } from '../reports/csv';
import { StockService } from './stock.service';
import { toBaseQuantity } from './units';

const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface WasteFilters {
  from?: Date;
  to?: Date;
  ingredientId?: string;
  reason?: string;
  shift?: string;
  employeeId?: string;
  location?: string;
  kind?: 'INGREDIENT' | 'FINISHED';
  status?: string;
}

const INCLUDE = {
  ingredient: { select: { id: true, name: true, unit: true, kind: true } },
} satisfies Prisma.WasteEntryInclude;

// Food waste through the stock journal. The one decision the kitchen must make is whether the loss is
// ALREADY inside a production entry (the batch simply yielded less): then it is recorded for the
// report but stock is not touched again. Otherwise it is extra waste and leaves stock exactly once.
@Injectable()
export class WasteEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async create(
    branchId: string,
    userId: string,
    dto: WasteEntryDto,
    canApprove: boolean,
  ) {
    if (dto.idempotencyKey) {
      const dup = await this.prisma.wasteEntry.findUnique({
        where: {
          branchId_idempotencyKey: {
            branchId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        include: INCLUDE,
      });
      if (dup) return dup;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const ing = await tx.ingredient.findFirst({
          where: { id: dto.ingredientId, branchId },
        });
        if (!ing) throw new NotFoundException('Stock item not found');
        const entered = Dec(dto.quantity);
        const qty = toBaseQuantity(
          entered,
          dto.unit,
          ing.unit,
          ing.conversions,
          ing.name,
        );

        if (dto.includedInProduction) {
          const prod = await tx.productionEntry.findFirst({
            where: { id: dto.productionEntryId, branchId, status: 'POSTED' },
            include: { lines: true },
          });
          if (!prod)
            throw new BadRequestException(
              'That production entry is not posted, so the loss cannot be attached to it',
            );
          if (!prod.lines.some((l) => l.ingredientId === ing.id)) {
            throw new BadRequestException(
              `${ing.name} is not part of that production entry`,
            );
          }
        }

        const needsApproval =
          !dto.includedInProduction &&
          !canApprove &&
          ing.wasteApprovalQty != null &&
          qty.gt(ing.wasteApprovalQty);

        const entry = await tx.wasteEntry.create({
          data: {
            branchId,
            kind: ing.kind === 'PREPARED' ? 'FINISHED' : 'INGREDIENT',
            ingredientId: ing.id,
            enteredQuantity: entered,
            enteredUnit: dto.unit,
            quantity: qty,
            reason: dto.reason,
            shift: dto.shift,
            location: dto.location,
            note: dto.note,
            photoUrl: dto.photoUrl,
            occurredAt: dto.occurredAt ?? new Date(),
            includedInProduction: dto.includedInProduction,
            productionEntryId: dto.includedInProduction
              ? dto.productionEntryId
              : null,
            status: needsApproval ? 'PENDING_APPROVAL' : 'POSTED',
            idempotencyKey: dto.idempotencyKey,
            deviceId: dto.deviceId,
            createdById: userId,
          },
        });

        if (!dto.includedInProduction) {
          // Stock leaves now: the food is already in the bin. A manager can still reject it later,
          // which puts the quantity back through a reversal.
          await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ing.id} FOR UPDATE`;
          const portions = await this.stock.consumeStock(
            tx,
            branchId,
            ing.id,
            qty,
            {
              type: 'WASTE',
              note: dto.note ?? dto.reason,
              userId,
              allowNegative: false,
              refs: { wasteEntryId: entry.id, deviceId: dto.deviceId },
            },
          );
          for (const p of portions) {
            await tx.wasteLog.create({
              data: {
                branchId,
                ingredientId: ing.id,
                batchId: p.batchId,
                quantity: p.quantity,
                reason: dto.reason,
                unitCostAtWaste: p.unitCost,
                notes: dto.note,
                createdById: userId,
                entryId: entry.id,
              },
            });
          }
        }
        await this.audit.record({
          userId,
          action: 'waste.record',
          entity: 'WasteEntry',
          entityId: entry.id,
          metadata: {
            qty: qty.toString(),
            reason: dto.reason,
            status: entry.status,
            includedInProduction: dto.includedInProduction,
          },
        });
        return tx.wasteEntry.findUniqueOrThrow({
          where: { id: entry.id },
          include: INCLUDE,
        });
      });
    } catch (e) {
      if (
        dto.idempotencyKey &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const dup = await this.prisma.wasteEntry.findUnique({
          where: {
            branchId_idempotencyKey: {
              branchId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          include: INCLUDE,
        });
        if (dup) return dup;
      }
      throw e;
    }
  }

  async approve(branchId: string, userId: string, id: string, note?: string) {
    const r = await this.prisma.wasteEntry.updateMany({
      where: { id, branchId, status: 'PENDING_APPROVAL' },
      data: {
        status: 'POSTED',
        approvedById: userId,
        approvedAt: new Date(),
        decisionNote: note,
      },
    });
    if (r.count === 0)
      throw new BadRequestException(
        'Only an entry waiting for approval can be approved',
      );
    await this.audit.record({
      userId,
      action: 'waste.approve',
      entity: 'WasteEntry',
      entityId: id,
      metadata: { note },
    });
    return this.get(branchId, id);
  }

  /** Reject = reverse. Both put the stock back through an appended REVERSAL, never a delete. */
  async reject(branchId: string, userId: string, id: string, note?: string) {
    return this.reverseWith(
      branchId,
      userId,
      id,
      note ?? 'Rejected',
      'REJECTED',
    );
  }

  async reverse(branchId: string, userId: string, id: string, reason: string) {
    return this.reverseWith(branchId, userId, id, reason, 'REVERSED');
  }

  private async reverseWith(
    branchId: string,
    userId: string,
    id: string,
    reason: string,
    to: 'REVERSED' | 'REJECTED',
  ) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.wasteEntry.updateMany({
        where: { id, branchId, status: { in: ['POSTED', 'PENDING_APPROVAL'] } },
        data: {
          status: to,
          reversedById: userId,
          reversedAt: new Date(),
          reverseReason: reason,
        },
      });
      if (claimed.count === 0)
        throw new BadRequestException(
          'This entry is already reversed or rejected',
        );
      const moves = await tx.stockMovement.findMany({
        where: { wasteEntryId: id, branchId, type: 'WASTE' },
      });
      for (const m of moves) {
        const back = Dec(m.quantity).negated();
        await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${m.ingredientId} FOR UPDATE`;
        const ing = await tx.ingredient.findUniqueOrThrow({
          where: { id: m.ingredientId },
        });
        if (m.batchId) {
          const batch = await tx.stockBatch.findUnique({
            where: { id: m.batchId },
          });
          if (batch) {
            await tx.stockBatch.update({
              where: { id: batch.id },
              data: {
                quantityRemaining: Dec(batch.quantityRemaining).plus(back),
              },
            });
          }
        }
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: m.ingredientId,
            batchId: m.batchId,
            type: 'REVERSAL',
            quantity: back,
            note: `Reversal of waste: ${reason}`,
            createdById: userId,
            wasteEntryId: id,
          },
        });
        await tx.ingredient.update({
          where: { id: m.ingredientId },
          data: { currentStock: Dec(ing.currentStock).plus(back) },
        });
      }
      await this.audit.record({
        userId,
        action: `waste.${to.toLowerCase()}`,
        entity: 'WasteEntry',
        entityId: id,
        metadata: { reason },
      });
    });
    return this.get(branchId, id);
  }

  async get(branchId: string, id: string) {
    const e = await this.prisma.wasteEntry.findFirst({
      where: { id, branchId },
      include: INCLUDE,
    });
    if (!e) throw new NotFoundException('Waste entry not found');
    return e;
  }

  private where(
    branchId: string,
    f: WasteFilters,
  ): Prisma.WasteEntryWhereInput {
    return {
      branchId,
      ...(f.ingredientId ? { ingredientId: f.ingredientId } : {}),
      ...(f.reason ? { reason: f.reason as never } : {}),
      ...(f.shift ? { shift: f.shift } : {}),
      ...(f.employeeId ? { createdById: f.employeeId } : {}),
      ...(f.location ? { location: f.location } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.from || f.to
        ? {
            occurredAt: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {}),
    };
  }

  async list(branchId: string, f: WasteFilters, take = 200) {
    const rows = await this.prisma.wasteEntry.findMany({
      where: this.where(branchId, f),
      include: INCLUDE,
      orderBy: { occurredAt: 'desc' },
      take: Math.min(take, 1000),
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } },
      select: { id: true, name: true },
    });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      ...r,
      createdByName: name.get(r.createdById) ?? null,
    }));
  }

  /**
   * Quantities only. Reversed and rejected entries are left out of the totals, and so are entries
   * flagged as already inside a production entry (kept in `alreadyInProduction` so nothing is counted twice).
   * Money is deliberately absent: no cost source is trusted for produced food.
   */
  async report(branchId: string, f: WasteFilters) {
    const rows = await this.list(branchId, f, 1000);
    const live = rows.filter(
      (r) => r.status === 'POSTED' || r.status === 'PENDING_APPROVAL',
    );
    const extra = live.filter((r) => !r.includedInProduction);
    const group = (
      key: (r: (typeof rows)[number]) => string,
      label: (r: (typeof rows)[number]) => string,
    ) => {
      const m = new Map<
        string,
        {
          key: string;
          label: string;
          unit: string;
          quantity: Prisma.Decimal;
          count: number;
        }
      >();
      for (const r of extra) {
        const k = `${key(r)}|${r.ingredient.unit}`;
        const cur = m.get(k);
        m.set(k, {
          key: key(r),
          label: label(r),
          unit: r.ingredient.unit,
          quantity: (cur?.quantity ?? Dec(0)).plus(r.quantity),
          count: (cur?.count ?? 0) + 1,
        });
      }
      return [...m.values()].map((v) => ({
        ...v,
        quantity: v.quantity.toString(),
      }));
    };
    const byDay = new Map<string, number>();
    for (const r of extra) {
      const d = r.occurredAt.toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    return {
      entryCount: extra.length,
      byItem: group(
        (r) => r.ingredientId,
        (r) => r.ingredient.name,
      ),
      byReason: group(
        (r) => r.reason,
        (r) => r.reason,
      ),
      byShift: group(
        (r) => r.shift ?? '-',
        (r) => r.shift ?? 'No shift',
      ),
      byEmployee: group(
        (r) => r.createdById,
        (r) => r.createdByName ?? 'Unknown',
      ),
      byKind: group(
        (r) => r.kind,
        (r) => r.kind,
      ),
      trend: [...byDay.entries()]
        .sort()
        .map(([day, entries]) => ({ day, entries })),
      alreadyInProduction: live.filter((r) => r.includedInProduction).length,
      pendingApproval: rows.filter((r) => r.status === 'PENDING_APPROVAL')
        .length,
    };
  }

  async exportCsv(branchId: string, f: WasteFilters) {
    const rows = await this.list(branchId, f, 1000);
    return toCsv(
      [
        'When',
        'Item',
        'Type',
        'Quantity',
        'Unit',
        'Reason',
        'Shift',
        'Location',
        'Employee',
        'Status',
        'Counted in production',
        'Note',
        'Reversal reason',
      ],
      rows.map((r) => [
        r.occurredAt,
        r.ingredient.name,
        r.kind === 'FINISHED' ? 'Finished food' : 'Ingredient',
        r.quantity.toString(),
        r.ingredient.unit,
        r.reason,
        r.shift,
        r.location,
        r.createdByName,
        r.status,
        r.includedInProduction ? 'yes' : 'no',
        r.note,
        r.reverseReason,
      ]),
    );
  }
}
