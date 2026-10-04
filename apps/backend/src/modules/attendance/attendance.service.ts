import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const WITH_USER = {
  user: { select: { id: true, name: true } },
} as const;

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's currently open shift, if any (any branch). */
  current(userId: string) {
    return this.prisma.attendance.findFirst({
      where: { userId, clockOutAt: null },
      include: WITH_USER,
      orderBy: { clockInAt: 'desc' },
    });
  }

  async clockIn(userId: string, branchId: string, note?: string) {
    if (await this.current(userId))
      throw new BadRequestException('Already clocked in');
    return this.prisma.attendance.create({
      data: { userId, branchId, note },
      include: WITH_USER,
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

  /** Records for a branch, optionally one day (YYYY-MM-DD) or one user. */
  list(branchId: string, date?: string, userId?: string) {
    let range: { gte: Date; lt: Date } | undefined;
    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      if (Number.isNaN(start.getTime()))
        throw new BadRequestException('date must be YYYY-MM-DD');
      range = { gte: start, lt: new Date(start.getTime() + 86_400_000) };
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
}
