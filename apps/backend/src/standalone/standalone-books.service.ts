import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionUser } from '@nodedr-restaurant/types';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../modules/orders/orders.service';
import type {
  PhoneCollectionDto,
  PhoneExpenseDto,
  PhoneRefundDto,
  PhoneTillClosingDto,
} from './standalone.schema';

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isUniqueClash = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * The phone's books reaching the server: refunds, expenses, money collected on a bill left due, and each phone's own
 * day-end cash count. Every call carries the phone's event id, and a repeat answers with the first result.
 */
@Injectable()
export class StandaloneBooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  /** The server order made from a phone sale, or a clear message when the server does not have that sale. */
  private async orderOfSale(branchId: string, saleId: string) {
    const order = await this.prisma.order.findFirst({
      where: { branchId, clientRequestId: saleId },
      select: { id: true, orderNumber: true, status: true },
    });
    if (!order) {
      throw new ConflictException(
        'The server does not have this sale yet. Send the sale first (or fix it if it was refused), then try again.',
      );
    }
    return order;
  }

  async refund(user: SessionUser, branchId: string, dto: PhoneRefundDto) {
    const done = await this.prisma.refund.findUnique({
      where: { clientRequestId: dto.idempotencyKey },
      select: { id: true, amount: true },
    });
    if (done) return { status: 'duplicate', refundId: done.id };
    const order = await this.orderOfSale(branchId, dto.saleId);
    try {
      const r = (await this.orders.refund(
        branchId,
        order.id,
        user.id,
        {
          amount: dto.amount,
          method: dto.method,
          reason: dto.reason
            ? `${dto.reason} (refunded on a phone)`
            : 'Refunded on a phone',
        },
        dto.idempotencyKey,
      )) as { id?: string };
      return {
        status: 'created',
        refundId: r?.id,
        orderNumber: order.orderNumber,
      };
    } catch (e) {
      if (isUniqueClash(e)) return { status: 'duplicate' };
      throw e;
    }
  }

  async expense(user: SessionUser, branchId: string, dto: PhoneExpenseDto) {
    const done = await this.prisma.expense.findUnique({
      where: { clientRequestId: dto.idempotencyKey },
      select: { id: true },
    });
    if (done) return { status: 'duplicate', expenseId: done.id };
    try {
      const e = await this.prisma.expense.create({
        data: {
          branchId,
          createdById: user.id,
          spentOn: dayStart(dto.spentOn),
          category: dto.category || 'Other',
          amount: dto.amount,
          note: dto.note,
          paidFromCash: dto.paidFromCash,
          clientRequestId: dto.idempotencyKey,
        },
        select: { id: true },
      });
      return { status: 'created', expenseId: e.id };
    } catch (e) {
      if (isUniqueClash(e)) return { status: 'duplicate' };
      throw e;
    }
  }

  /** Money taken later on a bill that was left (partly) unpaid on the phone. */
  async collect(user: SessionUser, branchId: string, dto: PhoneCollectionDto) {
    const order = await this.orderOfSale(branchId, dto.saleId);
    // A pay-later bill with nothing paid yet keeps its discount and service charge on the order (they were checked
    // when the sale was recorded); the first payment fixes the bill's figures, so it must carry them.
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        discountType: true,
        discountValue: true,
        discountReason: true,
        tipAmount: true,
        _count: { select: { payments: true } },
      },
    });
    const first = o._count.payments === 0;
    const value = o.discountValue == null ? 0 : Number(o.discountValue);
    // checkout() answers a repeat of the same requestId with the first result, before any other check.
    const r = (await this.orders.checkout(
      branchId,
      order.id,
      user.id,
      {
        payments: dto.payments,
        allowPartial: true,
        requestId: dto.idempotencyKey,
        ...(first && value > 0
          ? {
              ...(o.discountType === 'PERCENT'
                ? { discountPercent: value }
                : { discountFlat: value }),
              discountReason: o.discountReason ?? 'Offline sale discount',
            }
          : {}),
        ...(first && Number(o.tipAmount) > 0
          ? { tipAmount: Number(o.tipAmount) }
          : {}),
      },
      first && value > 0,
    )) as { status?: string; settlement?: { balanceDue?: number } };
    return {
      status: 'recorded',
      orderNumber: order.orderNumber,
      orderStatus: r?.status,
      balanceDue: r?.settlement?.balanceDue,
    };
  }

  /** A phone's own cash count for one day. Counting again the same day replaces it. */
  async tillClosing(
    user: SessionUser,
    branchId: string,
    dto: PhoneTillClosingDto,
  ) {
    const businessDate = dayStart(dto.businessDate);
    const data = {
      deviceName: dto.deviceName || 'Phone',
      openingFloat: dto.openingFloat,
      cashSales: dto.cashSales,
      cashRefunds: dto.cashRefunds,
      cashExpenses: dto.cashExpenses,
      expectedCash: dto.expectedCash,
      countedCash: dto.countedCash,
      variance: round2(dto.countedCash - dto.expectedCash),
      netSales: dto.netSales,
      closedByName: dto.closedByName,
      closedAt: new Date(dto.closedAt),
      syncedById: user.id,
    };
    const row = await this.prisma.phoneTillClosing.upsert({
      where: {
        branchId_deviceId_businessDate: {
          branchId,
          deviceId: dto.deviceId,
          businessDate,
        },
      },
      create: { branchId, deviceId: dto.deviceId, businessDate, ...data },
      update: data,
      select: { id: true },
    });
    return { status: 'saved', id: row.id };
  }

  listTillClosings(branchId: string) {
    return this.prisma.phoneTillClosing
      .findMany({
        where: { branchId },
        orderBy: [{ businessDate: 'desc' }, { deviceName: 'asc' }],
        take: 120,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          deviceName: r.deviceName,
          businessDate: r.businessDate.toISOString().slice(0, 10),
          openingFloat: Number(r.openingFloat),
          cashSales: Number(r.cashSales),
          cashRefunds: Number(r.cashRefunds),
          cashExpenses: Number(r.cashExpenses),
          expectedCash: Number(r.expectedCash),
          countedCash: Number(r.countedCash),
          variance: Number(r.variance),
          netSales: Number(r.netSales),
          closedByName: r.closedByName,
          closedAt: r.closedAt.toISOString(),
        })),
      );
  }
}
