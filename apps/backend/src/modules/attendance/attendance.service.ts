import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { zonedRange } from '../../common/time';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

const WITH_USER = {
  user: { select: { id: true, name: true } },
} as const;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
    private readonly audit: AuditService,
  ) {}

  /** The user's currently open shift, if any (any branch). */
  current(userId: string) {
    return this.prisma.attendance.findFirst({
      where: { userId, clockOutAt: null },
      include: WITH_USER,
      orderBy: { clockInAt: 'desc' },
    });
  }

  async clockIn(userId: string, branchId: string, note?: string) {
    // Two taps (or two devices) at once must not open two shifts: the check
    // and the insert happen under a per-user lock.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'clockin:' + userId}))`;
      const open = await tx.attendance.findFirst({
        where: { userId, clockOutAt: null },
      });
      if (open) throw new BadRequestException('Already clocked in');
      return tx.attendance.create({
        data: { userId, branchId, note },
        include: WITH_USER,
      });
    });
  }

  async clockOut(userId: string, note?: string) {
    const open = await this.current(userId);
    if (!open) throw new BadRequestException('Not clocked in');
    return this.prisma.attendance.update({
      where: { id: open.id },
      data: { clockOutAt: new Date(), ...(note ? { note } : {}) },
      include: WITH_USER,
    });
  }

  /** Records for a branch, optionally one local day (YYYY-MM-DD) or one user. */
  async list(branchId: string, date?: string, userId?: string) {
    let range: { gte: Date; lt: Date } | undefined;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
        throw new BadRequestException('date must be YYYY-MM-DD');
      range = zonedRange(date, date, await this.time.tzForBranch(branchId));
    }
    return this.prisma.attendance.findMany({
      where: {
        branchId,
        ...(userId ? { userId } : {}),
        ...(range ? { clockInAt: range } : {}),
      },
      include: WITH_USER,
      orderBy: { clockInAt: 'desc' },
      take: 500,
    });
  }

  /**
   * A manager corrects a record (a forgotten clock-out, a wrong time). Every
   * correction needs a reason and is audited with the before and after
   * values. It is refused when the record touches a payroll run that is
   * already finalized or paid, so approved figures cannot move underneath it.
   */
  async correct(
    restaurantId: string,
    actorId: string,
    id: string,
    dto: {
      clockInAt?: Date;
      clockOutAt?: Date | null;
      note?: string;
      reason: string;
    },
  ) {
    const rec = await this.prisma.attendance.findFirst({
      where: { id, branch: { restaurantId } },
    });
    if (!rec) throw new NotFoundException('Attendance record not found');

    const clockInAt = dto.clockInAt ?? rec.clockInAt;
    const clockOutAt =
      dto.clockOutAt === undefined ? rec.clockOutAt : dto.clockOutAt;
    const now = Date.now();
    if (clockInAt.getTime() > now + 60_000)
      throw new BadRequestException('Clock-in cannot be in the future');
    if (clockOutAt) {
      if (clockOutAt.getTime() > now + 60_000)
        throw new BadRequestException('Clock-out cannot be in the future');
      if (clockOutAt <= clockInAt)
        throw new BadRequestException('Clock-out must be after clock-in');
      if (clockOutAt.getTime() - clockInAt.getTime() > 24 * 3_600_000)
        throw new BadRequestException('A shift cannot be longer than 24 hours');
    }

    // Not on top of another shift of the same person.
    const overlap = await this.prisma.attendance.findFirst({
      where: {
        userId: rec.userId,
        id: { not: rec.id },
        clockInAt: { lt: clockOutAt ?? new Date(now + 24 * 3_600_000) },
        OR: [{ clockOutAt: null }, { clockOutAt: { gt: clockInAt } }],
      },
    });
    if (overlap)
      throw new BadRequestException(
        'This overlaps another shift of the same person',
      );

    // Not inside a payroll run that has been approved. Both the old and the
    // new position are checked, so a record cannot be moved out of one either.
    const days = [
      rec.clockInAt,
      rec.clockOutAt ?? rec.clockInAt,
      clockInAt,
      clockOutAt ?? clockInAt,
    ];
    const lo = new Date(Math.min(...days.map((d) => d.getTime())));
    const hi = new Date(Math.max(...days.map((d) => d.getTime())));
    const locked = await this.prisma.payrollRun.findFirst({
      where: {
        branchId: rec.branchId,
        status: { in: ['FINALIZED', 'PAID'] },
        periodStart: { lte: hi },
        periodEnd: { gte: new Date(lo.getTime() - 24 * 3_600_000) },
      },
    });
    if (locked)
      throw new BadRequestException(
        'This falls inside a payroll run that is already finalized - it cannot be changed',
      );

    const updated = await this.prisma.attendance.update({
      where: { id },
      data: {
        clockInAt,
        clockOutAt,
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
      include: WITH_USER,
    });
    await this.audit.record({
      userId: actorId,
      action: 'attendance.corrected',
      entity: 'Attendance',
      entityId: id,
      metadata: {
        reason: dto.reason,
        staff: updated.user.name,
        before: {
          clockInAt: rec.clockInAt,
          clockOutAt: rec.clockOutAt,
          note: rec.note,
        },
        after: {
          clockInAt: updated.clockInAt,
          clockOutAt: updated.clockOutAt,
          note: updated.note,
        },
      },
    });
    return updated;
  }
}
