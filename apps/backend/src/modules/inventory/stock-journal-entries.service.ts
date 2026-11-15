import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  StockJournalDraftDto,
  StockJournalEntryDto,
  StockJournalLineDto,
  StockJournalType,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { localDate } from '../../common/time';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from './stock.service';
import { toBaseQuantity } from './units';
import {
  JOURNAL_KEY_PREFIX,
  WasteEntriesService,
} from './waste-entries.service';

type Tx = Prisma.TransactionClient;
const Dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** What the signed-in user may do; set by the controller from their permissions. */
export interface JournalCaller {
  canApproveWaste: boolean;
}

export type JournalKind = 'PRODUCTION' | StockJournalType;
export type JournalStatus = 'DRAFT' | 'POSTED' | 'VOIDED';

export interface JournalListFilters {
  q?: string;
  type?: JournalKind;
  status?: JournalStatus;
  from?: Date;
  to?: Date;
  locationId?: string;
  sort?: 'date' | 'ref';
  dir?: 'asc' | 'desc';
  /** Production rows are included only for callers who can see production. */
  includeProduction: boolean;
  /** Transfer and correction rows need inventory.manage; waste needs production.record. */
  kinds: JournalKind[];
}

/** One row of the journal list, the same shape whichever kind of entry it came from. */
export interface JournalRow {
  id: string;
  kind: JournalKind;
  entryNo: string;
  status: JournalStatus;
  date: string;
  reason: string | null;
  out: { name: string; quantity: string; unit: string; place: string | null }[];
  in: { name: string; quantity: string; unit: string; place: string | null }[];
  places: string[];
  value: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
}

const LINE_INCLUDE = {
  ingredient: { select: { id: true, name: true, unit: true, kind: true } },
} satisfies Prisma.StockJournalLineInclude;

const TYPE_WORD: Record<StockJournalType, string> = {
  TRANSFER: 'Transfer',
  WASTE: 'Waste',
  CORRECTION: 'Correction',
};

/**
 * Stock journal entries for the three non-production kinds: transfer between places, waste/spoilage, correction.
 * They post into the existing ledger (StockMovement, WasteEntry, StockLevel, LocationTransfer); nothing here keeps a
 * second stock figure. A draft changes nothing. Posting claims the draft with a conditional update first, so a double
 * click or a retried request cannot post twice, and every stock change happens in that same transaction.
 */
@Injectable()
export class StockJournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly waste: WasteEntriesService,
    private readonly audit: AuditService,
  ) {}

  // ---- lines ---------------------------------------------------------------------------------

  private async resolveLines(
    tx: Tx,
    branchId: string,
    type: StockJournalType,
    lines: StockJournalLineDto[],
  ) {
    const ings = new Map(
      (
        await tx.ingredient.findMany({
          where: {
            id: { in: [...new Set(lines.map((l) => l.ingredientId))] },
            branchId,
          },
        })
      ).map((i) => [i.id, i]),
    );
    const locIds = [
      ...new Set(
        lines
          .flatMap((l) => [l.fromLocationId, l.toLocationId])
          .filter((x): x is string => !!x),
      ),
    ];
    const locs = new Map(
      (
        await tx.stockLocation.findMany({
          where: { id: { in: locIds }, branchId },
        })
      ).map((x) => [x.id, x]),
    );
    const seen = new Set<string>();
    return lines.map((l, i) => {
      const ing = ings.get(l.ingredientId);
      if (!ing)
        throw new NotFoundException('A stock item on this entry was not found');
      if (!ing.isActive)
        throw new BadRequestException(`${ing.name} is switched off`);
      if (type !== 'CORRECTION' && l.direction !== 'OUT')
        throw new BadRequestException('Only a stock correction can add stock');
      // One row per item (per route, for transfers), so a reviewer reads each movement once.
      const key = `${l.ingredientId}:${type === 'TRANSFER' ? `${l.fromLocationId ?? ''}>${l.toLocationId ?? ''}` : ''}`;
      if (seen.has(key))
        throw new BadRequestException(
          `${ing.name} is listed twice; combine it into one row`,
        );
      seen.add(key);
      const place = (id: string | null | undefined) => {
        if (!id) return null;
        const loc = locs.get(id);
        if (!loc)
          throw new BadRequestException(
            `The place chosen for ${ing.name} was not found`,
          );
        if (!loc.isActive)
          throw new BadRequestException(
            `${loc.name} is switched off; choose another place for ${ing.name}`,
          );
        return loc;
      };
      const from = place(l.fromLocationId);
      const to = place(
        type === 'TRANSFER' || l.direction === 'IN' ? l.toLocationId : null,
      );
      if (type === 'TRANSFER') {
        if (!to)
          throw new BadRequestException(`Choose where the ${ing.name} goes`);
        if ((from?.id ?? null) === to.id)
          throw new BadRequestException(
            `${ing.name}: From and To must be different places`,
          );
      }
      if (type === 'WASTE' && !l.wasteReason)
        throw new BadRequestException(
          `Choose why the ${ing.name} was thrown away`,
        );
      const entered = Dec(l.quantity);
      if (!entered.gt(0))
        throw new BadRequestException(
          `${ing.name}: quantity must be more than zero`,
        );
      const quantity = toBaseQuantity(
        entered,
        l.unit,
        ing.unit,
        ing.conversions,
        ing.name,
      );
      return {
        sortOrder: i,
        ingredientId: ing.id,
        direction: l.direction,
        enteredQuantity: entered,
        enteredUnit: l.unit,
        quantity,
        fromLocationId: from?.id ?? null,
        fromLocationName: from?.name ?? null,
        toLocationId: to?.id ?? null,
        toLocationName: to?.name ?? null,
        wasteReason: type === 'WASTE' ? (l.wasteReason ?? null) : null,
        note: l.note?.trim() || null,
      };
    });
  }

  /** SJ-YYYYMMDD-nnn on the restaurant's local date. Takes the highest number used that day, so deleting a draft never
   *  hands its number to a second entry (counting rows would). */
  private async nextEntryNo(tx: Tx, branchId: string, at: Date) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock-journal:' + branchId}))`;
    const b = await tx.branch.findUnique({
      where: { id: branchId },
      select: { restaurant: { select: { timezone: true } } },
    });
    const day = localDate(at, b?.restaurant.timezone ?? 'Asia/Kolkata').replace(
      /-/g,
      '',
    );
    const prefix = `SJ-${day}-`;
    const last = await tx.stockJournalEntry.findFirst({
      where: { branchId, entryNo: { startsWith: prefix } },
      orderBy: { entryNo: 'desc' },
      select: { entryNo: true },
    });
    const n = last ? Number(last.entryNo.slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(3, '0')}`;
  }

  // ---- create / edit / delete ----------------------------------------------------------------

  async create(
    branchId: string,
    userId: string,
    dto: StockJournalEntryDto,
    caller: JournalCaller,
  ) {
    if (dto.idempotencyKey) {
      const dup = await this.findByKey(branchId, dto.idempotencyKey);
      if (dup) return dup; // a retried save: the first result, nothing created or posted twice
    }
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const lines = await this.resolveLines(
          tx,
          branchId,
          dto.type,
          dto.lines,
        );
        const occurredAt = dto.occurredAt ?? new Date();
        const entry = await tx.stockJournalEntry.create({
          data: {
            branchId,
            entryNo: await this.nextEntryNo(tx, branchId, occurredAt),
            type: dto.type,
            occurredAt,
            reason: dto.reason?.trim() || null,
            notes: dto.notes?.trim() || null,
            idempotencyKey: dto.idempotencyKey,
            createdById: userId,
            lines: { create: lines },
          },
        });
        await this.audit.record({
          userId,
          action: 'stock_journal.create',
          entity: 'StockJournalEntry',
          entityId: entry.id,
          metadata: {
            entryNo: entry.entryNo,
            type: dto.type,
            lines: lines.length,
          },
        });
        if (dto.post)
          await this.postInTx(tx, branchId, userId, entry.id, caller);
        return entry.id;
      });
      return this.get(branchId, id);
    } catch (e) {
      if (
        dto.idempotencyKey &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const dup = await this.findByKey(branchId, dto.idempotencyKey);
        if (dup) return dup;
      }
      throw e;
    }
  }

  private async findByKey(branchId: string, idempotencyKey: string) {
    const e = await this.prisma.stockJournalEntry.findUnique({
      where: { branchId_idempotencyKey: { branchId, idempotencyKey } },
      select: { id: true },
    });
    return e ? this.get(branchId, e.id) : null;
  }

  async updateDraft(
    branchId: string,
    userId: string,
    id: string,
    dto: StockJournalDraftDto,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Lock the row so an edit cannot interleave with a post of the same draft.
      await tx.$queryRaw`SELECT id FROM stock_journal_entries WHERE id = ${id} FOR UPDATE`;
      const entry = await tx.stockJournalEntry.findFirst({
        where: { id, branchId },
      });
      if (!entry) throw new NotFoundException('Stock journal entry not found');
      if (entry.status !== 'DRAFT')
        throw new BadRequestException(
          'Only a draft can be edited. Reverse a posted entry and record a new one instead.',
        );
      if (entry.type !== dto.type)
        throw new BadRequestException(
          'The entry type cannot change. Delete this draft and start a new entry.',
        );
      const lines = await this.resolveLines(
        tx,
        branchId,
        entry.type,
        dto.lines,
      );
      await tx.stockJournalLine.deleteMany({ where: { entryId: id } });
      await tx.stockJournalEntry.update({
        where: { id },
        data: {
          occurredAt: dto.occurredAt ?? entry.occurredAt,
          reason: dto.reason?.trim() || null,
          notes: dto.notes?.trim() || null,
          lines: { create: lines },
        },
      });
      await this.audit.record({
        userId,
        action: 'stock_journal.update',
        entity: 'StockJournalEntry',
        entityId: id,
        metadata: { entryNo: entry.entryNo, lines: lines.length },
      });
    });
    return this.get(branchId, id);
  }

  async deleteDraft(branchId: string, userId: string, id: string) {
    const e = await this.prisma.stockJournalEntry.findFirst({
      where: { id, branchId },
    });
    if (!e) throw new NotFoundException('Stock journal entry not found');
    const r = await this.prisma.stockJournalEntry.deleteMany({
      where: { id, branchId, status: 'DRAFT' },
    });
    if (r.count === 0)
      throw new BadRequestException(
        'Only a draft can be deleted. Reverse a posted entry instead.',
      );
    await this.audit.record({
      userId,
      action: 'stock_journal.delete_draft',
      entity: 'StockJournalEntry',
      entityId: id,
      metadata: { entryNo: e.entryNo, type: e.type },
    });
    return { ok: true };
  }

  // ---- post ------------------------------------------------------------------------------------

  async post(
    branchId: string,
    userId: string,
    id: string,
    caller: JournalCaller,
  ) {
    await this.prisma.$transaction((tx) =>
      this.postInTx(tx, branchId, userId, id, caller),
    );
    return this.get(branchId, id);
  }

  /** Move how much of an item is recorded in one place. Taking more than the place holds is refused. */
  private async shiftLevel(
    tx: Tx,
    ingredientId: string,
    locationId: string,
    delta: Prisma.Decimal,
    what: { name: string; unit: string; place: string },
  ) {
    const row = await tx.stockLevel.findUnique({
      where: { ingredientId_locationId: { ingredientId, locationId } },
    });
    const cur = Dec(row?.quantity ?? 0);
    const next = cur.plus(delta);
    if (next.isNegative())
      throw new BadRequestException(
        `Only ${cur.toString()} ${what.unit} of ${what.name} is recorded in ${what.place}. Count that place or choose another one.`,
      );
    await tx.stockLevel.upsert({
      where: { ingredientId_locationId: { ingredientId, locationId } },
      create: { ingredientId, locationId, quantity: next },
      update: { quantity: next },
    });
  }

  /** Stock of an item not recorded in any place. */
  private async unassigned(
    tx: Tx,
    ingredientId: string,
    total: Prisma.Decimal,
  ) {
    const levels = await tx.stockLevel.findMany({ where: { ingredientId } });
    const placed = levels.reduce((a, l) => a.plus(l.quantity), Dec(0));
    const u = total.minus(placed);
    return u.isNegative() ? Dec(0) : u;
  }

  private async postInTx(
    tx: Tx,
    branchId: string,
    userId: string,
    id: string,
    caller: JournalCaller,
  ) {
    // The conditional update is the guard: a second post of the same draft changes nothing and fails.
    const claimed = await tx.stockJournalEntry.updateMany({
      where: { id, branchId, status: 'DRAFT' },
      data: { status: 'POSTED', postedById: userId, postedAt: new Date() },
    });
    if (claimed.count === 0) {
      const e = await tx.stockJournalEntry.findFirst({
        where: { id, branchId },
      });
      if (!e) throw new NotFoundException('Stock journal entry not found');
      throw new ConflictException(
        `${e.entryNo} is already ${e.status === 'VOIDED' ? 'reversed' : 'posted'}`,
      );
    }
    const entry = await tx.stockJournalEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    // Lock every item in a fixed order so two entries sharing items cannot deadlock.
    for (const ingredientId of [
      ...new Set(entry.lines.map((l) => l.ingredientId)),
    ].sort()) {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`;
    }
    const label = `${TYPE_WORD[entry.type]} ${entry.entryNo}`;
    const refs = { journalEntryId: id };

    for (const l of entry.lines) {
      const ing = await tx.ingredient.findUniqueOrThrow({
        where: { id: l.ingredientId },
      });
      const what = (place: string | null) => ({
        name: ing.name,
        unit: ing.unit,
        place: place ?? 'that place',
      });
      const note = [label, entry.reason, l.note].filter(Boolean).join(': ');

      if (entry.type === 'TRANSFER') {
        if (!l.toLocationId)
          throw new BadRequestException(`Choose where the ${ing.name} goes`);
        if (l.fromLocationId) {
          await this.shiftLevel(
            tx,
            ing.id,
            l.fromLocationId,
            Dec(l.quantity).negated(),
            what(l.fromLocationName),
          );
        } else {
          const free = await this.unassigned(tx, ing.id, Dec(ing.currentStock));
          if (free.lt(l.quantity))
            throw new BadRequestException(
              `Only ${free.toString()} ${ing.unit} of ${ing.name} is not yet placed anywhere. Choose the place it is in now, or count the places first.`,
            );
        }
        await this.shiftLevel(
          tx,
          ing.id,
          l.toLocationId,
          Dec(l.quantity),
          what(l.toLocationName),
        );
        // The Areas page history shows the same move.
        await tx.locationTransfer.create({
          data: {
            branchId,
            ingredientId: ing.id,
            fromLocationId: l.fromLocationId,
            toLocationId: l.toLocationId,
            quantity: l.quantity,
            note: note.slice(0, 300),
            idempotencyKey: `${JOURNAL_KEY_PREFIX}${l.id}`,
            createdById: userId,
          },
        });
      } else if (entry.type === 'WASTE') {
        if (l.fromLocationId)
          await this.shiftLevel(
            tx,
            ing.id,
            l.fromLocationId,
            Dec(l.quantity).negated(),
            what(l.fromLocationName),
          );
        // A real waste record, so the Waste reports, approvals and costs include it. Stock leaves through it.
        const w = await this.waste.createInTx(
          tx,
          branchId,
          userId,
          {
            ingredientId: ing.id,
            quantity: l.enteredQuantity.toString(),
            unit: l.enteredUnit,
            reason: l.wasteReason ?? 'OTHER',
            location: l.fromLocationName ?? undefined,
            note: [label, l.note ?? entry.reason]
              .filter(Boolean)
              .join(': ')
              .slice(0, 1000),
            occurredAt: entry.occurredAt,
            includedInProduction: false,
            idempotencyKey: `${JOURNAL_KEY_PREFIX}${l.id}`,
          },
          caller.canApproveWaste,
          id,
        );
        await tx.stockJournalLine.update({
          where: { id: l.id },
          data: { wasteEntryId: w.id },
        });
        if (l.fromLocationId)
          await tx.stockMovement.updateMany({
            where: { wasteEntryId: w.id, type: 'WASTE' },
            data: { locationId: l.fromLocationId },
          });
      } else if (l.direction === 'OUT') {
        if (l.fromLocationId)
          await this.shiftLevel(
            tx,
            ing.id,
            l.fromLocationId,
            Dec(l.quantity).negated(),
            what(l.fromLocationName),
          );
        await this.stock.consumeStock(tx, branchId, ing.id, l.quantity, {
          type: 'ADJUSTMENT',
          note,
          userId,
          allowNegative: false, // never below zero
          refs,
        });
        if (l.fromLocationId)
          await tx.stockMovement.updateMany({
            where: {
              journalEntryId: id,
              ingredientId: ing.id,
              type: 'ADJUSTMENT',
              quantity: { lt: 0 },
            },
            data: { locationId: l.fromLocationId },
          });
      } else {
        // Correction upward: same as the existing "Adjust stock > Add" (a zero-cost batch; the average cost is unchanged).
        const batch = await tx.stockBatch.create({
          data: {
            branchId,
            ingredientId: ing.id,
            batchNumber: entry.entryNo,
            quantityReceived: l.quantity,
            quantityRemaining: l.quantity,
            unitCost: 0,
          },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            ingredientId: ing.id,
            batchId: batch.id,
            type: 'ADJUSTMENT',
            quantity: l.quantity,
            note,
            createdById: userId,
            locationId: l.toLocationId,
            ...refs,
          },
        });
        await tx.ingredient.update({
          where: { id: ing.id },
          data: { currentStock: Dec(ing.currentStock).plus(l.quantity) },
        });
        if (l.toLocationId)
          await this.shiftLevel(
            tx,
            ing.id,
            l.toLocationId,
            Dec(l.quantity),
            what(l.toLocationName),
          );
      }
      // Value at the item's average cost when posted (the app's cost basis). Display only.
      await tx.stockJournalLine.update({
        where: { id: l.id },
        data: { unitCost: Dec(ing.costPerUnit).gt(0) ? ing.costPerUnit : null },
      });
    }
    await this.audit.record({
      userId,
      action: 'stock_journal.post',
      entity: 'StockJournalEntry',
      entityId: id,
      metadata: {
        entryNo: entry.entryNo,
        type: entry.type,
        lines: entry.lines.length,
      },
    });
  }

  // ---- reverse ---------------------------------------------------------------------------------

  async void(branchId: string, userId: string, id: string, reason: string) {
    await this.prisma.$transaction((tx) =>
      this.voidInTx(tx, branchId, userId, id, reason),
    );
    return this.get(branchId, id);
  }

  private async voidInTx(
    tx: Tx,
    branchId: string,
    userId: string,
    id: string,
    reason: string,
  ) {
    const claimed = await tx.stockJournalEntry.updateMany({
      where: { id, branchId, status: 'POSTED' },
      data: {
        status: 'VOIDED',
        voidedById: userId,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });
    if (claimed.count === 0) {
      const e = await tx.stockJournalEntry.findFirst({
        where: { id, branchId },
      });
      if (!e) throw new NotFoundException('Stock journal entry not found');
      throw new BadRequestException(
        e.status === 'DRAFT'
          ? 'A draft has changed nothing; delete it instead.'
          : `${e.entryNo} is already reversed`,
      );
    }
    const entry = await tx.stockJournalEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const ingredientId of [
      ...new Set(entry.lines.map((l) => l.ingredientId)),
    ].sort()) {
      await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${ingredientId} FOR UPDATE`;
    }
    const note = `Reversal of ${entry.entryNo}: ${reason}`;

    if (entry.type === 'TRANSFER') {
      for (const l of entry.lines) {
        const ing = await tx.ingredient.findUniqueOrThrow({
          where: { id: l.ingredientId },
        });
        const row = await tx.stockLevel.findUnique({
          where: {
            ingredientId_locationId: {
              ingredientId: ing.id,
              locationId: l.toLocationId!,
            },
          },
        });
        if (Dec(row?.quantity ?? 0).lt(l.quantity))
          throw new BadRequestException(
            `Cannot reverse: ${l.toLocationName} no longer holds ${l.quantity.toString()} ${ing.unit} of ${ing.name} (it has been used or moved on). Record a new transfer instead.`,
          );
        await this.shiftLevel(
          tx,
          ing.id,
          l.toLocationId!,
          Dec(l.quantity).negated(),
          {
            name: ing.name,
            unit: ing.unit,
            place: l.toLocationName ?? 'that place',
          },
        );
        if (l.fromLocationId) {
          await this.shiftLevel(tx, ing.id, l.fromLocationId, Dec(l.quantity), {
            name: ing.name,
            unit: ing.unit,
            place: l.fromLocationName ?? 'that place',
          });
          await tx.locationTransfer.create({
            data: {
              branchId,
              ingredientId: ing.id,
              fromLocationId: l.toLocationId,
              toLocationId: l.fromLocationId,
              quantity: l.quantity,
              note: note.slice(0, 300),
              idempotencyKey: `${JOURNAL_KEY_PREFIX}rev:${l.id}`,
              createdById: userId,
            },
          });
        }
      }
    } else if (entry.type === 'WASTE') {
      for (const l of entry.lines) {
        if (!l.wasteEntryId) continue;
        // Already rejected by a manager on the Waste page: its stock is back, so only the journal status changes.
        const done = await this.waste.reverseInTx(
          tx,
          branchId,
          userId,
          l.wasteEntryId,
          note,
          'REVERSED',
          {
            allowAlreadyReversed: true,
            journalEntryId: id,
          },
        );
        if (done && l.fromLocationId)
          await this.shiftLevel(
            tx,
            l.ingredientId,
            l.fromLocationId,
            Dec(l.quantity),
            {
              name: '',
              unit: '',
              place: '',
            },
          );
      }
    } else {
      // Correction: put every movement back, newest batches untouched except the ones this entry wrote.
      const moves = await tx.stockMovement.findMany({
        where: { journalEntryId: id, branchId, type: 'ADJUSTMENT' },
      });
      // Additions first: if any added stock has already been used, reversing would push the item below what is there.
      for (const m of moves.filter((x) => Dec(x.quantity).gt(0))) {
        const ing = await tx.ingredient.findUniqueOrThrow({
          where: { id: m.ingredientId },
        });
        const batch = m.batchId
          ? await tx.stockBatch.findUnique({ where: { id: m.batchId } })
          : null;
        if (
          !batch ||
          Dec(batch.quantityRemaining).lt(m.quantity) ||
          Dec(ing.currentStock).lt(m.quantity)
        )
          throw new BadRequestException(
            `Cannot reverse: some of the ${ing.name} this correction added has already been used. Record a new correction instead.`,
          );
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: {
            quantityRemaining: Dec(batch.quantityRemaining).minus(m.quantity),
          },
        });
        if (m.locationId) {
          const row = await tx.stockLevel.findUnique({
            where: {
              ingredientId_locationId: {
                ingredientId: ing.id,
                locationId: m.locationId,
              },
            },
          });
          // The place may have moved on since; never below zero, "unassigned" absorbs the difference.
          const next = Prisma.Decimal.max(
            Dec(0),
            Dec(row?.quantity ?? 0).minus(m.quantity),
          );
          if (row)
            await tx.stockLevel.update({
              where: { id: row.id },
              data: { quantity: next },
            });
        }
        await this.reversal(
          tx,
          branchId,
          userId,
          id,
          m,
          Dec(m.quantity).negated(),
          note,
        );
        await tx.ingredient.update({
          where: { id: ing.id },
          data: { currentStock: Dec(ing.currentStock).minus(m.quantity) },
        });
      }
      for (const m of moves.filter((x) => Dec(x.quantity).lt(0))) {
        const back = Dec(m.quantity).negated();
        const ing = await tx.ingredient.findUniqueOrThrow({
          where: { id: m.ingredientId },
        });
        if (m.batchId) {
          const batch = await tx.stockBatch.findUnique({
            where: { id: m.batchId },
          });
          if (batch)
            await tx.stockBatch.update({
              where: { id: batch.id },
              data: {
                quantityRemaining: Dec(batch.quantityRemaining).plus(back),
              },
            });
        }
        if (m.locationId)
          await this.shiftLevel(tx, ing.id, m.locationId, back, {
            name: ing.name,
            unit: ing.unit,
            place: '',
          });
        await this.reversal(tx, branchId, userId, id, m, back, note);
        await tx.ingredient.update({
          where: { id: ing.id },
          data: { currentStock: Dec(ing.currentStock).plus(back) },
        });
      }
    }
    await this.audit.record({
      userId,
      action: 'stock_journal.void',
      entity: 'StockJournalEntry',
      entityId: id,
      metadata: { entryNo: entry.entryNo, type: entry.type, reason },
    });
  }

  private reversal(
    tx: Tx,
    branchId: string,
    userId: string,
    journalEntryId: string,
    m: {
      ingredientId: string;
      batchId: string | null;
      locationId: string | null;
    },
    quantity: Prisma.Decimal,
    note: string,
  ) {
    return tx.stockMovement.create({
      data: {
        branchId,
        ingredientId: m.ingredientId,
        batchId: m.batchId,
        type: 'REVERSAL',
        quantity,
        note,
        createdById: userId,
        locationId: m.locationId,
        journalEntryId,
      },
    });
  }

  // ---- read ------------------------------------------------------------------------------------

  async get(branchId: string, id: string) {
    const e = await this.prisma.stockJournalEntry.findFirst({
      where: { id, branchId },
      include: {
        lines: { include: LINE_INCLUDE, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!e) throw new NotFoundException('Stock journal entry not found');
    const people = await this.people([
      e.createdById,
      e.postedById,
      e.voidedById,
    ]);
    const wasteIds = e.lines
      .map((l) => l.wasteEntryId)
      .filter((x): x is string => !!x);
    const wastes = new Map(
      (
        await this.prisma.wasteEntry.findMany({
          where: { id: { in: wasteIds } },
          select: { id: true, status: true },
        })
      ).map((w) => [w.id, w.status]),
    );
    const value = this.valueOf(e.lines);
    return {
      ...e,
      kind: e.type,
      createdByName: people.get(e.createdById) ?? null,
      postedByName: e.postedById ? (people.get(e.postedById) ?? null) : null,
      voidedByName: e.voidedById ? (people.get(e.voidedById) ?? null) : null,
      value,
      lines: e.lines.map((l) => ({
        ...l,
        value: l.unitCost
          ? Dec(l.unitCost).mul(l.quantity).toDecimalPlaces(2).toString()
          : null,
        wasteStatus: l.wasteEntryId
          ? (wastes.get(l.wasteEntryId) ?? null)
          : null,
      })),
    };
  }

  private valueOf(
    lines: {
      unitCost: Prisma.Decimal | null;
      quantity: Prisma.Decimal;
      direction: string;
    }[],
  ) {
    if (!lines.length || lines.some((l) => !l.unitCost)) return null;
    return lines
      .reduce(
        (a, l) =>
          a.plus(
            Dec(l.unitCost!)
              .mul(l.quantity)
              .mul(l.direction === 'IN' ? 1 : -1),
          ),
        Dec(0),
      )
      .toDecimalPlaces(2)
      .toString();
  }

  private async people(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: list } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /**
   * Every kind of entry in one list: production vouchers and these three. Filters run in the database; the two
   * sources are merged, sorted and capped here.
   */
  async list(
    branchId: string,
    f: JournalListFilters,
    take = 300,
  ): Promise<JournalRow[]> {
    const q = f.q?.trim();
    const date = (field: 'occurredAt' | 'producedAt') =>
      f.from || f.to
        ? {
            [field]: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {};
    const wantJournal = f.kinds.filter(
      (k): k is StockJournalType =>
        k !== 'PRODUCTION' && (!f.type || f.type === k),
    );
    const wantProduction =
      f.includeProduction &&
      f.kinds.includes('PRODUCTION') &&
      (!f.type || f.type === 'PRODUCTION');
    const nameMatch = q
      ? { ingredient: { name: { contains: q, mode: 'insensitive' as const } } }
      : undefined;

    const [journal, production] = await Promise.all([
      this.prisma.stockJournalEntry.findMany({
        where: {
          branchId,
          type: { in: wantJournal },
          ...(f.status ? { status: f.status } : {}),
          ...date('occurredAt'),
          ...(q
            ? {
                OR: [
                  { entryNo: { contains: q, mode: 'insensitive' } },
                  { lines: { some: nameMatch } },
                ],
              }
            : {}),
          ...(f.locationId
            ? {
                lines: {
                  some: {
                    OR: [
                      { fromLocationId: f.locationId },
                      { toLocationId: f.locationId },
                    ],
                  },
                },
              }
            : {}),
        },
        include: {
          lines: { include: LINE_INCLUDE, orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { occurredAt: 'desc' },
        take,
      }),
      this.prisma.productionEntry.findMany({
        where: {
          branchId,
          ...(wantProduction ? {} : { id: { in: [] } }),
          ...(f.status ? { status: f.status } : {}),
          ...date('producedAt'),
          ...(q
            ? {
                OR: [
                  { entryNo: { contains: q, mode: 'insensitive' } },
                  { batchRef: { contains: q, mode: 'insensitive' } },
                  { lines: { some: nameMatch } },
                ],
              }
            : {}),
          ...(f.locationId
            ? { lines: { some: { locationId: f.locationId } } }
            : {}),
        },
        include: {
          lines: {
            include: { ingredient: { select: { name: true, unit: true } } },
          },
        },
        orderBy: { producedAt: 'desc' },
        take,
      }),
    ]);
    const people = await this.people([
      ...journal.flatMap((e) => [e.createdById, e.postedById]),
      ...production.flatMap((e) => [e.createdById, e.postedById]),
    ]);
    const qty = (l: {
      enteredQuantity: Prisma.Decimal;
      enteredUnit: string;
    }) => ({
      quantity: Dec(l.enteredQuantity).toString(),
      unit: l.enteredUnit,
    });
    const rows: JournalRow[] = [
      ...journal.map((e) => {
        const out = e.lines
          .filter((l) => l.direction === 'OUT')
          .map((l) => ({
            name: l.ingredient.name,
            ...qty(l),
            place: l.fromLocationName,
          }));
        // A transfer's rows also arrive somewhere: show them on the "in" side too, at the destination.
        const inn = e.lines
          .filter((l) => l.direction === 'IN' || e.type === 'TRANSFER')
          .map((l) => ({
            name: l.ingredient.name,
            ...qty(l),
            place: l.toLocationName,
          }));
        const places = [
          ...new Set(
            e.lines
              .flatMap((l) => [l.fromLocationName, l.toLocationName])
              .filter((x): x is string => !!x),
          ),
        ];
        return {
          id: e.id,
          kind: e.type,
          entryNo: e.entryNo,
          status: e.status,
          date: e.occurredAt.toISOString(),
          reason: e.reason,
          out,
          in: inn,
          places,
          value: e.type === 'TRANSFER' ? null : this.valueOf(e.lines),
          createdBy: people.get(e.createdById) ?? null,
          postedBy: e.postedById ? (people.get(e.postedById) ?? null) : null,
          postedAt: e.postedAt?.toISOString() ?? null,
        };
      }),
      ...production.map((e) => ({
        id: e.id,
        kind: 'PRODUCTION' as const,
        entryNo: e.entryNo,
        status: e.status,
        date: e.producedAt.toISOString(),
        reason: e.notes,
        out: e.lines
          .filter((l) => l.role === 'INPUT')
          .map((l) => ({
            name: l.ingredient.name,
            ...qty(l),
            place: l.locationName,
          })),
        in: e.lines
          .filter((l) => l.role === 'OUTPUT')
          .map((l) => ({
            name: l.ingredient.name,
            ...qty(l),
            place: l.locationName,
          })),
        places: [
          ...new Set(
            [e.location, ...e.lines.map((l) => l.locationName)].filter(
              (x): x is string => !!x,
            ),
          ),
        ],
        value: e.totalCost
          ? Dec(e.totalCost).toDecimalPlaces(2).toString()
          : null,
        createdBy: people.get(e.createdById) ?? null,
        postedBy: e.postedById ? (people.get(e.postedById) ?? null) : null,
        postedAt: e.postedAt?.toISOString() ?? null,
      })),
    ];
    const dir = f.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) =>
      f.sort === 'ref'
        ? a.entryNo.localeCompare(b.entryNo, undefined, { numeric: true }) * dir
        : (a.date < b.date
            ? -1
            : a.date > b.date
              ? 1
              : a.entryNo.localeCompare(b.entryNo)) * dir,
    );
    return rows.slice(0, take);
  }
}
