import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateWaitlistEntryDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  listWaiting(branchId: string) {
    return this.prisma.waitlistEntry.findMany({
      where: { branchId, status: 'WAITING' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(branchId: string, dto: CreateWaitlistEntryDto) {
    const created = await this.prisma.waitlistEntry.create({
      data: { ...dto, branchId },
    });
    this.realtime.emitToBranch(branchId, 'waitlist.created', {
      id: created.id,
    });
    return created;
  }

  async seat(branchId: string, id: string, tableId: string) {
    const entry = await this.prisma.waitlistEntry.findFirst({
      where: { id, branchId },
    });
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    if (entry.status !== 'WAITING') {
      throw new BadRequestException('Entry is not waiting');
    }
    // A client-supplied tableId from another branch/restaurant must never
    // be trusted directly — without this check, this write would flip a
    // foreign tenant's real table to OCCUPIED on their own live floor view.
    const table = await this.prisma.table.findFirst({
      where: { id: tableId, floor: { branchId } },
      select: { id: true },
    });
    if (!table) {
      throw new BadRequestException('Table is invalid for this branch');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.waitlistEntry.update({
        where: { id },
        data: { status: 'SEATED', tableId, seatedAt: new Date() },
      });
      await tx.table.update({
        where: { id: tableId },
        data: { status: 'OCCUPIED' },
      });
      return result;
    });

    this.realtime.emitToBranch(branchId, 'waitlist.updated', {
      id: updated.id,
    });
    this.realtime.emitToBranch(branchId, 'table.updated', { id: tableId });
    return updated;
  }

  async cancel(branchId: string, id: string) {
    const entry = await this.prisma.waitlistEntry.findFirst({
      where: { id, branchId },
    });
    if (!entry) throw new NotFoundException('Waitlist entry not found');

    const updated = await this.prisma.waitlistEntry.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    this.realtime.emitToBranch(branchId, 'waitlist.updated', {
      id: updated.id,
    });
    return updated;
  }
}
