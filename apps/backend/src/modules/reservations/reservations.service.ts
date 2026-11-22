import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateReservationDto,
  ReservationStatusDto,
} from '@nodedr-restaurant/types';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { WebhooksService } from '../webhooks/webhooks.service';

export interface CreateReservationOptions {
  // True only for the public "website" booking path (integrations.service's
  // createReservation, called with an `reservations:write` API key). Staff
  // creating a reservation from the dashboard are never capped — they can
  // always merge tables or make a judgment call the online flow can't.
  fromWebsite?: boolean;
}

// A reservation only moves forward. Terminal states (COMPLETED, CANCELLED, NO_SHOW) are final, so a stale tab or a
// replayed request can never reopen a booking and flip the floor view.
const TRANSITIONS: Record<ReservationStatusDto, ReservationStatusDto[]> = {
  RESERVED: ['CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
// Bookings that still hold their table.
const ACTIVE: ReservationStatusDto[] = ['RESERVED', 'CONFIRMED', 'ARRIVED'];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
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

  async create(
    branchId: string,
    dto: CreateReservationDto,
    options: CreateReservationOptions = {},
  ) {
    // A client-supplied tableId from another branch/restaurant must never
    // be trusted directly — without this check, this write would flip a
    // foreign tenant's real table to RESERVED on their own live floor view.
    if (dto.tableId) {
      const table = await this.prisma.table.findFirst({
        where: { id: dto.tableId, floor: { branchId } },
        select: { id: true },
      });
      if (!table) {
        throw new BadRequestException('Table is invalid for this branch');
      }
    }

    if (options.fromWebsite) {
      await this.assertWithinOnlineBookingCapacity(branchId, dto.guestCount);
    }

    // Website bookings are "online"; with auto-confirm on they skip the
    // manual Accept step and go straight to CONFIRMED.
    const autoConfirm = options.fromWebsite
      ? (
          await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { autoConfirmReservations: true },
          })
        )?.autoConfirmReservations
      : false;

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.tableId) {
        // Serialise bookings for one table: without the row lock two simultaneous requests both see it free.
        await tx.$queryRaw`SELECT id FROM "tables" WHERE id = ${dto.tableId} FOR UPDATE`;
        await this.assertTableFree(
          tx,
          dto.tableId,
          dto.reservedAt,
          dto.durationMinutes,
        );
      }
      const reservation = await tx.reservation.create({
        data: {
          ...dto,
          branchId,
          ...(options.fromWebsite ? { channel: 'ONLINE' as const } : {}),
          ...(autoConfirm ? { status: 'CONFIRMED' as const } : {}),
        },
      });
      // Holding a table for a reservation marks it RESERVED on the floor
      // view immediately, not just when the guest physically arrives.
      if (reservation.tableId) {
        await tx.table.update({
          where: { id: reservation.tableId },
          data: { status: 'RESERVED', statusSince: new Date() },
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

    // Best-effort, same pattern as OrdersService.checkout()'s "order.new"
    // notify: the reservation has already committed by this point, so a
    // notification failure must never surface as a failed booking. Targeted
    // by permission (reservations.manage), not a hardcoded role, so any
    // custom front-of-house role holding it gets the alert.
    try {
      await this.notifications.notifyByPermission(
        branchId,
        'reservations.manage',
        {
          type: 'reservation.new',
          title: options.fromWebsite
            ? 'New online reservation'
            : 'New reservation',
          body: `${created.customerName} — party of ${created.guestCount}, ${new Date(
            created.reservedAt,
          ).toLocaleString()}`,
          entity: 'Reservation',
          entityId: created.id,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send reservation.new notification for reservation ${created.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    void this.webhooks.emitForBranch(branchId, 'reservation.created', {
      reservationId: created.id,
      customerName: created.customerName,
      phone: created.phone,
      guestCount: created.guestCount,
      reservedAt: created.reservedAt,
      channel: created.channel,
    });

    return created;
  }

  // Online (website/API) bookings are capped at what roughly 2 tables can
  // seat — a large party still gets in touch with the restaurant directly
  // rather than the site silently accepting a booking no single pair of
  // tables can actually hold. Computed from the branch's own configured
  // table capacities (largest two), not a hardcoded guest count, since
  // table sizes vary per restaurant. If the branch has no tables configured
  // yet, there's nothing to compare against — fail open rather than block
  // every online booking because the floor plan isn't set up.
  private async assertWithinOnlineBookingCapacity(
    branchId: string,
    guestCount: number,
  ) {
    const tables = await this.prisma.table.findMany({
      where: { floor: { branchId } },
      select: { capacity: true },
      orderBy: { capacity: 'desc' },
      take: 2,
    });
    if (tables.length === 0) return;

    const maxOnlineGuests = tables.reduce((sum, t) => sum + t.capacity, 0);
    if (guestCount > maxOnlineGuests) {
      throw new BadRequestException(
        `Online booking is limited to ${maxOnlineGuests} guests (about 2 tables). For a larger party, please call the restaurant directly to reserve.`,
      );
    }
  }

  /** 409 when another active booking on this table overlaps [at, at + minutes). */
  private async assertTableFree(
    tx: Prisma.TransactionClient,
    tableId: string,
    at: Date,
    minutes: number,
    exceptId?: string,
  ) {
    const start = new Date(at).getTime();
    const end = start + minutes * 60_000;
    // Bookings are at most a day or so long; fetch a generous window and compare exact overlap in code.
    const near = await tx.reservation.findMany({
      where: {
        tableId,
        status: { in: ACTIVE },
        ...(exceptId ? { id: { not: exceptId } } : {}),
        reservedAt: {
          gte: new Date(start - 24 * 3_600_000),
          lt: new Date(end),
        },
      },
      select: { reservedAt: true, durationMinutes: true },
    });
    const clash = near.some((r) => {
      const rs = r.reservedAt.getTime();
      return rs < end && rs + r.durationMinutes * 60_000 > start;
    });
    if (clash) {
      throw new ConflictException(
        'That table is already booked for an overlapping time. Choose another table or time.',
      );
    }
  }

  /**
   * The floor status of a table, worked out from what is actually true (a live order, a seated booking, a held
   * booking) rather than from whichever status change happened last. CLEANING / OUT_OF_SERVICE are staff decisions
   * and are never overridden here.
   */
  private async syncTableStatus(tx: Prisma.TransactionClient, tableId: string) {
    const table = await tx.table.findUnique({
      where: { id: tableId },
      select: { status: true },
    });
    if (
      !table ||
      table.status === 'CLEANING' ||
      table.status === 'OUT_OF_SERVICE'
    )
      return;
    const liveOrder = await tx.order.findFirst({
      where: { tableId, status: 'OPEN' },
      select: { id: true },
    });
    const seated = liveOrder
      ? null
      : await tx.reservation.findFirst({
          where: { tableId, status: 'ARRIVED' },
          select: { id: true },
        });
    const held =
      liveOrder || seated
        ? null
        : await tx.reservation.findFirst({
            where: { tableId, status: { in: ['RESERVED', 'CONFIRMED'] } },
            select: { id: true },
          });
    const next =
      liveOrder || seated ? 'OCCUPIED' : held ? 'RESERVED' : 'AVAILABLE';
    if (next !== table.status) {
      await tx.table.update({
        where: { id: tableId },
        data: { status: next, statusSince: new Date() },
      });
    }
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

    // Re-sending the status it already has (a double tap, a retry) changes nothing.
    if (reservation.status === status) return reservation;
    if (!TRANSITIONS[reservation.status].includes(status)) {
      throw new BadRequestException(
        `A ${reservation.status.toLowerCase().replace('_', ' ')} reservation cannot be changed to ${status.toLowerCase().replace('_', ' ')}.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.reservation.update({
        where: { id },
        data: { status },
      });
      if (result.tableId) await this.syncTableStatus(tx, result.tableId);
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
