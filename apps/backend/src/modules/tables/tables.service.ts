import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BulkTableCreateDto,
  BulkTableDeleteDto,
  BulkTableUpdateDto,
  FloorDto,
  FloorUpdateDto,
  TableDto,
  TableLayoutUpdateDto,
  TableStatusDto,
  TableUpdateDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Service view hides inactive floors and tables the active layout leaves out; the editor sees all. */
  listFloors(branchId: string, forEditing = false) {
    return this.prisma.floor.findMany({
      where: { branchId, ...(forEditing ? {} : { isActive: true }) },
      orderBy: { sortOrder: 'asc' },
      include: {
        layouts: { select: { id: true, name: true, isActive: true }, orderBy: { sortOrder: 'asc' } },
        tables: {
          ...(forEditing ? {} : { where: { hidden: false } }),
          include: { assignedWaiter: { select: { id: true, name: true } } },
        },
      },
    });
  }

  createFloor(branchId: string, dto: FloorDto) {
    return this.prisma.floor.create({ data: { ...dto, branchId } });
  }

  async updateFloor(branchId: string, id: string, dto: FloorUpdateDto) {
    await this.assertFloorInBranch(branchId, id);
    return this.prisma.floor.update({ where: { id }, data: dto });
  }

  // ---- saved layouts ---------------------------------------------------------------------

  /** Save how the floor looks right now (visible tables and their places) under a name. */
  async saveLayout(branchId: string, floorId: string, name: string) {
    await this.assertFloorInBranch(branchId, floorId);
    const tables = await this.prisma.table.findMany({ where: { floorId, hidden: false } });
    const snapshot = tables.map((t) => ({
      tableId: t.id, posX: t.posX, posY: t.posY, width: t.width, height: t.height, rotation: t.rotation,
    }));
    const clash = await this.prisma.floorLayout.findUnique({ where: { floorId_name: { floorId, name } } });
    if (clash) throw new BadRequestException('A layout with that name already exists on this floor.');
    const count = await this.prisma.floorLayout.count({ where: { floorId } });
    return this.prisma.floorLayout.create({
      data: { floorId, name, tables: snapshot, sortOrder: count, isActive: count === 0 },
    });
  }

  async renameLayout(branchId: string, id: string, name: string) {
    const l = await this.layoutIn(branchId, id);
    return this.prisma.floorLayout.update({ where: { id: l.id }, data: { name } });
  }

  async deleteLayout(branchId: string, id: string) {
    const l = await this.layoutIn(branchId, id);
    if (l.isActive) throw new ConflictException('This layout is in use. Switch to another layout first.');
    await this.prisma.floorLayout.delete({ where: { id } });
    return { ok: true };
  }

  /** Overwrite a layout with the floor as it looks now (after rearranging in the editor). */
  async updateLayoutFromFloor(branchId: string, id: string) {
    const l = await this.layoutIn(branchId, id);
    const tables = await this.prisma.table.findMany({ where: { floorId: l.floorId, hidden: false } });
    return this.prisma.floorLayout.update({
      where: { id },
      data: {
        tables: tables.map((t) => ({
          tableId: t.id, posX: t.posX, posY: t.posY, width: t.width, height: t.height, rotation: t.rotation,
        })),
      },
    });
  }

  /**
   * Make a layout the live one. Tables in it move to their saved place; tables that are not in it are
   * hidden. It refuses when a table that would be hidden still has an open order or booking, so nobody's
   * bill disappears from the floor.
   */
  async activateLayout(branchId: string, id: string) {
    const l = await this.layoutIn(branchId, id);
    const spec = (l.tables as unknown as { tableId: string; posX: number; posY: number; width: number; height: number; rotation: number }[]) ?? [];
    const inLayout = new Set(spec.map((s) => s.tableId));
    const all = await this.prisma.table.findMany({ where: { floorId: l.floorId }, select: { id: true, number: true } });
    const leaving = all.filter((t) => !inLayout.has(t.id));
    const busy = await this.blockers(leaving.map((t) => t.id));
    if (busy.size > 0) {
      const names = leaving.filter((t) => busy.has(t.id)).map((t) => t.number).join(', ');
      throw new ConflictException(`Table ${names} still has an open order or booking and is not in this layout. Close or move it first.`);
    }
    await this.prisma.$transaction([
      ...spec.map((s) =>
        this.prisma.table.updateMany({
          where: { id: s.tableId, floorId: l.floorId },
          data: { posX: s.posX, posY: s.posY, width: s.width, height: s.height, rotation: s.rotation, hidden: false },
        }),
      ),
      this.prisma.table.updateMany({ where: { id: { in: leaving.map((t) => t.id) } }, data: { hidden: true } }),
      this.prisma.floorLayout.updateMany({ where: { floorId: l.floorId }, data: { isActive: false } }),
      this.prisma.floorLayout.update({ where: { id }, data: { isActive: true } }),
    ]);
    const tables = await this.prisma.table.findMany({ where: { floorId: l.floorId } });
    tables.forEach((t) => this.realtime.emitToBranch(branchId, 'table.updated', t));
    return { ok: true, shown: spec.length, hidden: leaving.length };
  }

  private async layoutIn(branchId: string, id: string) {
    const l = await this.prisma.floorLayout.findFirst({ where: { id, floor: { branchId } } });
    if (!l) throw new NotFoundException('Layout not found');
    return l;
  }

  async createTable(branchId: string, dto: TableDto) {
    await this.assertFloorInBranch(branchId, dto.floorId);
    const table = await this.prisma.table.create({ data: dto });
    this.realtime.emitToBranch(branchId, 'table.updated', table);
    return table;
  }

  async createTables(branchId: string, dto: BulkTableCreateDto) {
    await this.assertFloorInBranch(branchId, dto.floorId);

    const numbers = dto.numbers.map((n) => n.trim()).filter(Boolean);
    const duplicatesInBatch = numbers.filter(
      (n, i) => numbers.indexOf(n) !== i,
    );
    if (duplicatesInBatch.length > 0) {
      throw new BadRequestException(
        `Table numbers must be unique: ${[...new Set(duplicatesInBatch)].join(', ')} ${duplicatesInBatch.length > 1 ? 'are' : 'is'} repeated.`,
      );
    }

    const existing = await this.prisma.table.findMany({
      where: { floorId: dto.floorId, number: { in: numbers } },
      select: { number: true },
    });
    if (existing.length > 0) {
      const clashes = existing.map((t) => t.number).join(', ');
      throw new BadRequestException(
        `These table numbers already exist on this floor: ${clashes}. Choose different numbers.`,
      );
    }

    const tables = await this.prisma.$transaction(
      numbers.map((number, index) =>
        this.prisma.table.create({
          data: {
            floorId: dto.floorId,
            number,
            capacity: dto.capacity,
            shape: dto.shape,
            color: dto.color,
            width: dto.width ?? 80,
            height: dto.height ?? 80,
            posX: 20 + (index % dto.columns) * ((dto.width ?? 80) + 20),
            posY: 20 + Math.floor(index / dto.columns) * ((dto.height ?? 80) + 20),
          },
        }),
      ),
    );
    tables.forEach((table) =>
      this.realtime.emitToBranch(branchId, 'table.updated', table),
    );
    return tables;
  }

  async updateTable(branchId: string, id: string, dto: TableUpdateDto) {
    await this.assertTableInBranch(branchId, id);
    const table = await this.prisma.table.update({ where: { id }, data: dto });
    this.realtime.emitToBranch(branchId, 'table.updated', table);
    return table;
  }

  async updateTableLayout(branchId: string, updates: TableLayoutUpdateDto[]) {
    const owned = await this.prisma.table.findMany({
      where: { id: { in: updates.map((u) => u.id) }, floor: { branchId } },
      select: { id: true },
    });
    if (owned.length !== updates.length) {
      throw new BadRequestException(
        'One or more tables are invalid for this branch',
      );
    }

    const results = await this.prisma.$transaction(
      updates.map(({ id, ...rest }) =>
        this.prisma.table.update({ where: { id }, data: rest }),
      ),
    );
    this.realtime.emitToBranch(branchId, 'table.layout.updated', results);
    return results;
  }

  async updateTableStatus(
    branchId: string,
    id: string,
    status: TableStatusDto,
    assignedWaiterId?: string,
  ) {
    await this.assertTableInBranch(branchId, id);
    // A table with an unpaid bill cannot be marked free/reserved/cleaning by
    // hand - that is how a live order ended up hidden behind an "Available"
    // tile. Pay or cancel the bill first (both release the table themselves).
    if (status !== 'OCCUPIED') {
      const open = await this.prisma.order.findFirst({
        where: { tableId: id, status: 'OPEN' },
        select: { orderNumber: true },
      });
      if (open) {
        throw new ConflictException(
          `This table has an open bill (#${open.orderNumber}) - pay or cancel it first`,
        );
      }
    }
    const table = await this.prisma.table.update({
      where: { id },
      data: {
        status,
        statusSince: new Date(),
        ...(assignedWaiterId ? { assignedWaiterId } : {}),
      },
    });
    this.realtime.emitToBranch(branchId, 'table.updated', table);
    return table;
  }

  /** Tables that still have a live order or a booking cannot go; says which and what to do. */
  private async blockers(ids: string[]) {
    const [orders, bookings] = await Promise.all([
      this.prisma.order.findMany({
        where: { tableId: { in: ids }, status: { in: ['OPEN', 'BILLED'] } },
        select: { tableId: true },
      }),
      this.prisma.reservation.findMany({
        where: { tableId: { in: ids }, status: { in: ['RESERVED', 'CONFIRMED', 'ARRIVED'] } },
        select: { tableId: true },
      }),
    ]);
    const busy = new Set([...orders, ...bookings].map((r) => r.tableId as string));
    return busy;
  }

  async deleteTable(branchId: string, id: string) {
    await this.assertTableInBranch(branchId, id);
    if ((await this.blockers([id])).size > 0) {
      throw new ConflictException(
        'This table has an open order or an upcoming booking. Move the order to another table, close the bill or cancel the booking first.',
      );
    }
    await this.prisma.table.delete({ where: { id } });
    this.realtime.emitToBranch(branchId, 'table.deleted', { id });
    return { ok: true };
  }

  async updateTables(branchId: string, dto: BulkTableUpdateDto) {
    const tables = await this.prisma.table.findMany({
      where: { id: { in: dto.ids }, floor: { branchId } },
      select: { id: true },
    });
    if (tables.length !== new Set(dto.ids).size)
      throw new NotFoundException('One of the selected tables was not found');
    const { ids, ...data } = dto;
    await this.prisma.table.updateMany({ where: { id: { in: ids } }, data });
    const updated = await this.prisma.table.findMany({ where: { id: { in: ids } } });
    updated.forEach((t) => this.realtime.emitToBranch(branchId, 'table.updated', t));
    return updated;
  }

  /** All or nothing: if any selected table is in use nothing is deleted. */
  async deleteTables(branchId: string, dto: BulkTableDeleteDto) {
    const tables = await this.prisma.table.findMany({
      where: { id: { in: dto.ids }, floor: { branchId } },
      select: { id: true, number: true },
    });
    if (tables.length !== new Set(dto.ids).size)
      throw new NotFoundException('One of the selected tables was not found');
    const busy = await this.blockers(dto.ids);
    if (busy.size > 0) {
      const names = tables.filter((t) => busy.has(t.id)).map((t) => t.number).join(', ');
      throw new ConflictException(
        `Table ${names} ${busy.size > 1 ? 'have' : 'has'} an open order or an upcoming booking, so nothing was deleted. Close or move those first.`,
      );
    }
    await this.prisma.table.deleteMany({ where: { id: { in: dto.ids } } });
    dto.ids.forEach((id) => this.realtime.emitToBranch(branchId, 'table.deleted', { id }));
    return { deleted: dto.ids.length };
  }

  async rotateQrToken(branchId: string, id: string) {
    const table = await this.prisma.table.findFirst({
      where: { id, floor: { branchId } },
    });
    if (!table) throw new NotFoundException('Table not found');

    // opaque, unguessable token — not the table's own id, so a leaked QR
    // image can't be used to enumerate other tables' ids/data
    const qrToken = randomBytes(16).toString('hex');
    return this.prisma.table.update({ where: { id }, data: { qrToken } });
  }

  private async assertFloorInBranch(branchId: string, floorId: string) {
    const floor = await this.prisma.floor.findFirst({
      where: { id: floorId, branchId },
    });
    if (!floor) throw new NotFoundException('Floor not found');
  }

  private async assertTableInBranch(branchId: string, tableId: string) {
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, floor: { branchId } },
    });
    if (!table) throw new NotFoundException('Table not found');
  }

  /** Open guest requests (call waiter / bring bill) for a branch. */
  listOpenRequests(branchId: string) {
    return this.prisma.tableRequest.findMany({
      where: { branchId, resolvedAt: null },
      include: { table: { select: { id: true, number: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async resolveRequest(branchId: string, id: string) {
    const request = await this.prisma.tableRequest.findFirst({
      where: { id, branchId },
    });
    if (!request) throw new NotFoundException('Request not found');
    const updated = await this.prisma.tableRequest.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
    this.realtime.emitToBranch(branchId, 'table.request', { id });
    return updated;
  }
}
