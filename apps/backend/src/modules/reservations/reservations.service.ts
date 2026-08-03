import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateReservationDto,
  ReservationStatusDto,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  list(branchId: string, date?: string) {
    const where: Record<string, unknown> = { branchId };
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.reservedAt = { gte: start, lt: end };
    }
    return this.prisma.reservation.findMany({
      where,
      include: { table: { select: { id: true, number: true, name: true } } },
      orderBy: { reservedAt: 'asc' },
    });
  }

  async create(branchId: string, dto: CreateReservationDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.create({
        data: { ...dto, branchId },
      });
      // Holding a table for a reservation marks it RESERVED on the floor
      // view immediately, not just when the guest physically arrives.
      if (reservation.tableId) {
        await tx.table.update({
          where: { id: reservation.tableId },
          data: { status: 'RESERVED' },
        });
      }
      return reservation;
    });

    this.realtime.emitToBranch(branchId, 'reservation.created', {
      id: created.id,
    });
    if (created.tableId) {
      this.realtime.emitToBranch(branchId, 'table.updated', {
        id: created.tableId,
      });
    }
    return created;
  }

  async updateStatus(
    branchId: string,
    id: string,
    status: ReservationStatusDto,
  ) {
    const reservation = await this.prisma.reservation.findFirst({
      where: { id, branchId },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.reservation.update({
        where: { id },
        data: { status },
      });

      // Arriving a reservation with an assigned table occupies it; completing
      // or cancelling releases it back to available. Mirrors the same
      // table-status side effect checkout() already applies for dine-in
      // orders, kept consistent rather than leaving reservations silently
      // out of sync with the floor view.
      if (result.tableId) {
        if (status === 'ARRIVED') {
          await tx.table.update({
            where: { id: result.tableId },
            data: { status: 'OCCUPIED' },
          });
        } else if (
          status === 'COMPLETED' ||
          status === 'CANCELLED' ||
          status === 'NO_SHOW'
        ) {
          await tx.table.update({
            where: { id: result.tableId },
            data: { status: 'AVAILABLE' },
          });
        }
      }

      return result;
    });

    this.realtime.emitToBranch(branchId, 'reservation.updated', {
      id: updated.id,
      status,
    });
    if (updated.tableId) {
      this.realtime.emitToBranch(branchId, 'table.updated', {
        id: updated.tableId,
      });
    }
    return updated;
  }
}
