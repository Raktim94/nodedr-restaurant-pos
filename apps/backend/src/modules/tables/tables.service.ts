import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
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

  listFloors(branchId: string) {
    return this.prisma.floor.findMany({
      where: { branchId },
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
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

  async createTable(branchId: string, dto: TableDto) {
    await this.assertFloorInBranch(branchId, dto.floorId);
    const table = await this.prisma.table.create({ data: dto });
    this.realtime.emitToBranch(branchId, 'table.updated', table);
    return table;
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
    const table = await this.prisma.table.update({
      where: { id },
      data: { status, ...(assignedWaiterId ? { assignedWaiterId } : {}) },
    });
    this.realtime.emitToBranch(branchId, 'table.updated', table);
    return table;
  }

  async deleteTable(branchId: string, id: string) {
    await this.assertTableInBranch(branchId, id);
    await this.prisma.table.delete({ where: { id } });
    this.realtime.emitToBranch(branchId, 'table.deleted', { id });
    return { ok: true };
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
}
