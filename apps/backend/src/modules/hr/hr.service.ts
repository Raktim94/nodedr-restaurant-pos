import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  LeaveRequestDto,
  PayrollLineAdjustDto,
  PayrollPayDto,
  ShiftDto,
  StaffPayDto,
} from '@nodedr-restaurant/types';
import { localDate, zonedRange } from '../../common/time';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { PrismaService } from '../../prisma/prisma.service';
import { computePayroll, netWithAdjustments, round2 } from './payroll.calc';

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const USER = { select: { id: true, name: true } } as const;

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: BranchTimeService,
  ) {}

  private async assertStaffInBranch(branchId: string, userId: string) {
    const link = await this.prisma.userBranch.findFirst({
      where: { branchId, userId, user: { isActive: true } },
    });
    if (!link)
      throw new BadRequestException('That staff member is not in this branch');
  }

  // --- Shifts --------------------------------------------------------------

  async listShifts(
    branchId: string,
    from?: string,
    to?: string,
    userId?: string,
  ) {
    const tz = await this.time.tzForBranch(branchId);
    const r = zonedRange(from ?? to ?? '1970-01-01', to ?? '9999-12-30', tz);
    return this.prisma.shift.findMany({
      where: {
        branchId,
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              startsAt: {
                ...(from ? { gte: r.gte } : {}),
                ...(to ? { lt: r.lt } : {}),
              },
            }
          : {}),
      },
      include: { user: USER },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
  }

  async createShift(branchId: string, dto: ShiftDto) {
    await this.assertStaffInBranch(branchId, dto.userId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const clash = await this.prisma.shift.findFirst({
      where: {
        userId: dto.userId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (clash)
      throw new BadRequestException(
        'That person already has a shift at this time',
      );
    const tz = await this.time.tzForBranch(branchId);
    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        userId: dto.userId,
        status: 'APPROVED',
        startDate: { lte: dayStart(localDate(endsAt, tz)) },
        endDate: { gte: dayStart(localDate(startsAt, tz)) },
      },
    });
    if (onLeave)
      throw new BadRequestException(
        'That person has approved leave on this day',
      );
    return this.prisma.shift.create({
      data: { branchId, userId: dto.userId, startsAt, endsAt, note: dto.note },
      include: { user: USER },
    });
  }

  async deleteShift(branchId: string, id: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id, branchId },
    });
    if (!shift) throw new NotFoundException('Shift not found');
    await this.prisma.shift.delete({ where: { id } });
    return { ok: true };
  }

  // --- Leave ---------------------------------------------------------------

  async requestLeave(userId: string, dto: LeaveRequestDto) {
    await this.assertStaffInBranch(dto.branchId, userId);
    return this.prisma.leaveRequest.create({
      data: {
        branchId: dto.branchId,
        userId,
        type: dto.type,
        startDate: dayStart(dto.startDate),
        endDate: dayStart(dto.endDate),
        reason: dto.reason,
      },
    });
  }

  myLeave(userId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
      take: 100,
    });
  }

  listLeave(branchId: string, status?: string) {
    return this.prisma.leaveRequest.findMany({
      where: {
        branchId,
        ...(status === 'PENDING' ||
        status === 'APPROVED' ||
        status === 'REJECTED'
          ? { status }
          : {}),
      },
      include: { user: USER },
      orderBy: { startDate: 'desc' },
      take: 200,
    });
  }

  async decideLeave(
    branchId: string,
    id: string,
    deciderId: string,
    status: 'APPROVED' | 'REJECTED',
  ) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, branchId },
    });
    if (!leave) throw new NotFoundException('Leave request not found');
    if (leave.status !== 'PENDING')
      throw new BadRequestException('Already decided');
    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status, decidedById: deciderId, decidedAt: new Date() },
    });
  }

  // --- Pay profiles --------------------------------------------------------

  async listPay(branchId: string) {
    const links = await this.prisma.userBranch.findMany({
      where: { branchId, user: { isActive: true } },
      include: { user: { select: { id: true, name: true, payProfile: true } } },
    });
    return links.map((l) => ({
      userId: l.user.id,
      name: l.user.name,
      payType: l.user.payProfile?.payType ?? null,
      rate: l.user.payProfile ? Number(l.user.payProfile.rate) : null,
    }));
  }

  async setPay(branchId: string, userId: string, dto: StaffPayDto) {
    await this.assertStaffInBranch(branchId, userId);
    return this.prisma.staffPay.upsert({
      where: { userId },
      create: { userId, payType: dto.payType, rate: dto.rate },
      update: { payType: dto.payType, rate: dto.rate },
    });
  }

  // --- Payroll -------------------------------------------------------------

  listRuns(branchId: string) {
    return this.prisma.payrollRun.findMany({
      where: { branchId },
      orderBy: { periodStart: 'desc' },
      take: 50,
    });
  }

  async getRun(branchId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, branchId },
      include: {
        lines: { include: { user: USER }, orderBy: { user: { name: 'asc' } } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  /** Builds a DRAFT run from clock-in/out hours, pay profiles, leave and tips. */
  async createRun(branchId: string, periodStart: string, periodEnd: string) {
    const overlap = await this.prisma.payrollRun.findFirst({
      where: {
        branchId,
        periodStart: { lte: dayStart(periodEnd) },
        periodEnd: { gte: dayStart(periodStart) },
      },
    });
    if (overlap)
      throw new BadRequestException(
        'A payroll run already covers part of this period',
      );

    const from = dayStart(periodStart); // date columns (leave, payroll period)
    const tz = await this.time.tzForBranch(branchId);
    const zoned = zonedRange(periodStart, periodEnd, tz);

    const links = await this.prisma.userBranch.findMany({
      where: {
        branchId,
        user: { isActive: true, payProfile: { isNot: null } },
      },
      include: { user: { select: { id: true, payProfile: true } } },
    });
    if (links.length === 0)
      throw new BadRequestException(
        'Set a pay rate for at least one staff member first',
      );

    const records = await this.prisma.attendance.findMany({
      where: {
        branchId,
        clockOutAt: { not: null, gt: zoned.gte },
        clockInAt: { lt: zoned.lt },
      },
    });
    const hours = new Map<string, number>();
    for (const r of records) {
      const start = Math.max(r.clockInAt.getTime(), zoned.gte.getTime());
      const end = Math.min(r.clockOutAt!.getTime(), zoned.lt.getTime());
      if (end > start)
        hours.set(
          r.userId,
          (hours.get(r.userId) ?? 0) + (end - start) / 3_600_000,
        );
    }

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        branchId,
        status: 'APPROVED',
        type: 'UNPAID',
        startDate: { lte: dayStart(periodEnd) },
        endDate: { gte: from },
      },
    });
    const unpaidDays = new Map<string, number>();
    for (const l of leaves) {
      const s = Math.max(l.startDate.getTime(), from.getTime());
      const e = Math.min(l.endDate.getTime(), dayStart(periodEnd).getTime());
      if (e >= s)
        unpaidDays.set(
          l.userId,
          (unpaidDays.get(l.userId) ?? 0) +
            Math.round((e - s) / 86_400_000) +
            1,
        );
    }

    const tips = await this.prisma.order.aggregate({
      where: { branchId, status: 'PAID', billedAt: zoned },
      _sum: { tipAmount: true },
    });
    const tipPool = round2(Number(tips._sum.tipAmount ?? 0));

    const lines = computePayroll(
      periodStart,
      periodEnd,
      tipPool,
      links.map((l) => ({
        userId: l.user.id,
        payType: l.user.payProfile!.payType,
        rate: Number(l.user.payProfile!.rate),
        hoursWorked: hours.get(l.user.id) ?? 0,
        unpaidLeaveDays: unpaidDays.get(l.user.id) ?? 0,
      })),
    );

    // The overlap check above is a read followed by a write, so two requests
    // for the same period could both pass it. Serialise runs per branch and
    // check again inside the lock so a period is only ever paid for once.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payroll:' + branchId}))`;
      const again = await tx.payrollRun.findFirst({
        where: {
          branchId,
          periodStart: { lte: dayStart(periodEnd) },
          periodEnd: { gte: from },
        },
      });
      if (again)
        throw new BadRequestException(
          'A payroll run already covers part of this period',
        );
      return tx.payrollRun.create({
        data: {
          branchId,
          periodStart: from,
          periodEnd: dayStart(periodEnd),
          tipPool,
          totalNet: round2(lines.reduce((s, l) => s + l.netPay, 0)),
          lines: { create: lines },
        },
        include: { lines: { include: { user: USER } } },
      });
    });
  }

  /**
   * Allowances, bonus, advance recovery and other deductions for one person,
   * on a DRAFT run only (a finalized run is what was approved and must not
   * change under it). Net pay and the run total are recomputed from stored
   * figures in the same transaction.
   */
  async adjustLine(
    branchId: string,
    runId: string,
    userId: string,
    dto: PayrollLineAdjustDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id: runId, branchId },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'DRAFT')
        throw new BadRequestException(
          'Only a draft payroll can be adjusted - this one is ' +
            run.status.toLowerCase(),
        );
      const line = await tx.payrollLine.findFirst({ where: { runId, userId } });
      if (!line) throw new NotFoundException('That person is not on this run');

      const next = {
        allowances: dto.allowances ?? Number(line.allowances),
        bonus: dto.bonus ?? Number(line.bonus),
        advanceRecovery: dto.advanceRecovery ?? Number(line.advanceRecovery),
        otherDeductions: dto.otherDeductions ?? Number(line.otherDeductions),
      };
      let netPay: number;
      try {
        netPay = netWithAdjustments(
          {
            basePay: Number(line.basePay),
            tipShare: Number(line.tipShare),
            unpaidLeaveDeduction: Number(line.unpaidLeaveDeduction),
          },
          next,
        );
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const updated = await tx.payrollLine.update({
        where: { id: line.id },
        data: {
          ...next,
          netPay,
          ...(dto.adjustmentNote !== undefined
            ? { adjustmentNote: dto.adjustmentNote || null }
            : {}),
        },
        include: { user: USER },
      });
      const agg = await tx.payrollLine.aggregate({
        where: { runId },
        _sum: { netPay: true },
      });
      await tx.payrollRun.update({
        where: { id: runId },
        data: { totalNet: round2(Number(agg._sum.netPay ?? 0)) },
      });
      return updated;
    });
  }

  /**
   * FINALIZED -> PAID, once. The guarded update is the duplicate-payment
   * control: a second click, a retry or a second admin matches no row.
   */
  async payRun(
    branchId: string,
    id: string,
    userId: string,
    dto: PayrollPayDto,
  ) {
    const res = await this.prisma.payrollRun.updateMany({
      where: { id, branchId, status: 'FINALIZED' },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidById: userId,
        paymentMethod: dto.method,
        paymentRef: dto.reference || null,
      },
    });
    if (res.count === 0) {
      const run = await this.prisma.payrollRun.findFirst({
        where: { id, branchId },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      throw new BadRequestException(
        run.status === 'PAID'
          ? 'This payroll was already paid'
          : 'Finalize the payroll before paying it',
      );
    }
    return this.getRun(branchId, id);
  }

  /** Everything a salary slip shows for one person on one run. */
  async slip(branchId: string, runId: string, userId: string) {
    const run = await this.getRun(branchId, runId);
    const line = run.lines.find((l) => l.userId === userId);
    if (!line) throw new NotFoundException('That person is not on this run');
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: {
        name: true,
        address: true,
        restaurant: { select: { name: true, legalName: true } },
      },
    });
    return {
      employer: branch.restaurant.legalName ?? branch.restaurant.name,
      branch: branch.name,
      address: branch.address,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      paidAt: run.paidAt,
      paymentMethod: run.paymentMethod,
      employee: line.user.name,
      hoursWorked: Number(line.hoursWorked),
      earnings: {
        basePay: Number(line.basePay),
        tipShare: Number(line.tipShare),
        allowances: Number(line.allowances),
        bonus: Number(line.bonus),
      },
      deductions: {
        unpaidLeave: Number(line.unpaidLeaveDeduction),
        advanceRecovery: Number(line.advanceRecovery),
        other: Number(line.otherDeductions),
      },
      netPay: Number(line.netPay),
      note: line.adjustmentNote,
    };
  }

  async finalizeRun(branchId: string, id: string) {
    const run = await this.getRun(branchId, id);
    if (run.status !== 'DRAFT')
      throw new BadRequestException('Already finalized');
    return this.prisma.payrollRun.update({
      where: { id },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    });
  }

  async deleteRun(branchId: string, id: string) {
    const run = await this.getRun(branchId, id);
    if (run.status !== 'DRAFT')
      throw new BadRequestException(
        'A finalized payroll run cannot be deleted',
      );
    await this.prisma.payrollRun.delete({ where: { id } });
    return { ok: true };
  }

  // --- Performance ---------------------------------------------------------

  async performance(branchId: string, from: string, to: string) {
    const range = zonedRange(from, to, await this.time.tzForBranch(branchId));
    const f = range.gte;
    const t = range.lt;
    const [orders, attendance, links] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['createdById'],
        where: { branchId, status: 'PAID', billedAt: range },
        _count: { _all: true },
        _sum: { totalAmount: true, tipAmount: true },
      }),
      this.prisma.attendance.findMany({
        where: {
          branchId,
          clockOutAt: { not: null, gt: f },
          clockInAt: { lt: t },
        },
      }),
      this.prisma.userBranch.findMany({
        where: { branchId },
        include: { user: USER },
      }),
    ]);
    const hours = new Map<string, number>();
    for (const r of attendance) {
      const s = Math.max(r.clockInAt.getTime(), f.getTime());
      const e = Math.min(r.clockOutAt!.getTime(), t.getTime());
      if (e > s)
        hours.set(r.userId, (hours.get(r.userId) ?? 0) + (e - s) / 3_600_000);
    }
    const byUser = new Map(orders.map((o) => [o.createdById, o]));
    return links
      .map((l) => {
        const o = byUser.get(l.user.id);
        const h = hours.get(l.user.id) ?? 0;
        const sales = Number(o?._sum.totalAmount ?? 0);
        return {
          userId: l.user.id,
          name: l.user.name,
          orders: o?._count._all ?? 0,
          sales: round2(sales),
          tips: round2(Number(o?._sum.tipAmount ?? 0)),
          hoursWorked: round2(h),
          salesPerHour: h > 0 ? round2(sales / h) : null,
        };
      })
      .sort((a, b) => b.sales - a.sales);
  }
}
