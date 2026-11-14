import { Injectable, Logger } from '@nestjs/common';
import type { Reservation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type {
  PhoneReservationDto,
  PhoneReservationView,
  ReservationSyncDto,
  ReservationSyncResult,
} from './standalone.schema';

const PHONE_PREFIX = 'ph_';
// Bookings from yesterday on are sent to the phone; older ones are history.
const LOOKBACK_MS = 24 * 3600 * 1000;
const SNAPSHOT_LIMIT = 500;

export function toPhoneView(r: Reservation): PhoneReservationView {
  return {
    id: r.id,
    mine: r.id.startsWith(PHONE_PREFIX),
    customerName: r.customerName,
    phone: r.phone,
    guestCount: r.guestCount,
    reservedAt: r.reservedAt.toISOString(),
    durationMinutes: r.durationMinutes,
    tableId: r.tableId,
    specialRequests: r.specialRequests,
    status: r.status,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Two-way booking sync with a phone. Nothing here trusts the phone beyond
 * what a staff member with reservations.manage could already do in the app:
 * every row is scoped to the branch the caller proved access to, the phone can
 * only edit details of bookings it made, and the server copy wins ties.
 */
@Injectable()
export class StandaloneReservationsService {
  private readonly logger = new Logger(StandaloneReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async forSnapshot(branchId: string): Promise<PhoneReservationView[]> {
    const rows = await this.prisma.reservation.findMany({
      where: {
        branchId,
        reservedAt: { gte: new Date(Date.now() - LOOKBACK_MS) },
      },
      orderBy: { reservedAt: 'asc' },
      take: SNAPSHOT_LIMIT,
    });
    return rows.map(toPhoneView);
  }

  async sync(
    branchId: string,
    body: ReservationSyncDto,
  ): Promise<{ results: ReservationSyncResult[] }> {
    const tableIds = [
      ...new Set(body.reservations.map((r) => r.tableId).filter(Boolean)),
    ] as string[];
    const validTables = new Set(
      (
        await this.prisma.table.findMany({
          where: { id: { in: tableIds }, floor: { branchId } },
          select: { id: true },
        })
      ).map((t) => t.id),
    );

    const results: ReservationSyncResult[] = [];
    let changed = false;
    for (const r of body.reservations) {
      const key = (r.id ?? r.serverId) as string;
      try {
        const out = await this.one(branchId, r, validTables);
        if (out.status === 'saved') changed = true;
        results.push({ key, ...out });
      } catch (err) {
        this.logger.warn(
          `Booking ${key} not saved: ${err instanceof Error ? err.message : err}`,
        );
        results.push({
          key,
          status: 'refused',
          reason: 'The server could not save this booking.',
        });
      }
    }
    if (changed)
      this.realtime.emitToBranch(branchId, 'reservation.updated', {});
    return { results };
  }

  private async one(
    branchId: string,
    r: PhoneReservationDto,
    validTables: Set<string>,
  ): Promise<Omit<ReservationSyncResult, 'key'>> {
    if (r.tableId && !validTables.has(r.tableId)) {
      return { status: 'refused', reason: 'That table is not in this branch.' };
    }
    const phoneUpdated = new Date(r.updatedAt);
    const id = (r.id ?? r.serverId) as string;
    // Never let a phone address another tenant's row: look up by id AND branch,
    // and treat "exists elsewhere" exactly like "does not exist" when reading.
    const existing = await this.prisma.reservation.findFirst({
      where: { id, branchId },
    });

    if (!existing) {
      if (!r.id) {
        return {
          status: 'refused',
          reason: 'That booking is not on the server.',
        };
      }
      // Not found in this branch. If the id exists in another branch, refuse
      // without revealing it.
      const elsewhere = await this.prisma.reservation.findUnique({
        where: { id },
        select: { id: true },
      });
      if (elsewhere)
        return { status: 'refused', reason: 'Booking id is taken.' };
      const created = await this.prisma.reservation.create({
        data: {
          id,
          branchId,
          customerName: r.customerName,
          phone: r.phone || null,
          guestCount: r.guestCount,
          reservedAt: new Date(r.reservedAt),
          durationMinutes: r.durationMinutes,
          tableId: r.tableId ?? null,
          specialRequests: r.specialRequests || null,
          status: r.status,
          channel: 'STAFF',
        },
      });
      return { status: 'saved', reservation: toPhoneView(created) };
    }

    // The server copy changed after the phone last touched it: server wins.
    if (existing.updatedAt > phoneUpdated) {
      return { status: 'server_newer', reservation: toPhoneView(existing) };
    }

    const mine = existing.id.startsWith(PHONE_PREFIX);
    const data: Record<string, unknown> = { status: r.status };
    if (mine) {
      Object.assign(data, {
        customerName: r.customerName,
        phone: r.phone || null,
        guestCount: r.guestCount,
        reservedAt: new Date(r.reservedAt),
        durationMinutes: r.durationMinutes,
        tableId: r.tableId ?? null,
        specialRequests: r.specialRequests || null,
      });
    }
    const saved = await this.prisma.reservation.update({
      where: { id: existing.id },
      data,
    });
    return { status: 'saved', reservation: toPhoneView(saved) };
  }
}
