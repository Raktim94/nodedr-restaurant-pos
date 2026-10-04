import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CashClosingDto, ExpenseDto } from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';
import { expectedCash, gstSummary, round2 } from './accounting.calc';

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayAfter = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Expenses ------------------------------------------------------------

  listExpenses(branchId: string, from: string, to: string) {
    return this.prisma.expense.findMany({
      where: { branchId, spentOn: { gte: dayStart(from), lte: dayStart(to) } },
      orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  createExpense(branchId: string, userId: string, dto: ExpenseDto) {
    return this.prisma.expense.create({
      data: {
        branchId,
        createdById: userId,
        spentOn: dayStart(dto.spentOn),
        category: dto.category,
        amount: dto.amount,
        note: dto.note,
        paidFromCash: dto.paidFromCash,
      },
    });
  }

  async deleteExpense(branchId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, branchId },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    const closed = await this.prisma.cashClosing.findUnique({
      where: {
        branchId_businessDate: { branchId, businessDate: expense.spentOn },
      },
    });
    if (closed && expense.paidFromCash)
      throw new BadRequestException(
        'That day is already closed — the cash count includes this expense',
      );
    await this.prisma.expense.delete({ where: { id } });
    return { ok: true };
  }

  // --- Daily cash closing --------------------------------------------------

  /** What the till should hold for a day, before anyone counts it. */
  async closingPreview(branchId: string, date: string, openingFloat = 0) {
    const from = dayStart(date);
    const to = dayAfter(date);
    const [sales, refunds, expenses] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          method: 'CASH',
          createdAt: { gte: from, lt: to },
          order: { branchId },
        },
        _sum: { amount: true },
      }),
      this.prisma.refund.aggregate({
        where: {
          method: 'CASH',
          createdAt: { gte: from, lt: to },
          order: { branchId },
        },
        _sum: { amount: true },
      }),
      this.prisma.expense.aggregate({
        where: { branchId, spentOn: from, paidFromCash: true },
        _sum: { amount: true },
      }),
    ]);
    const cashSales = Number(sales._sum.amount ?? 0);
    const cashRefunds = Number(refunds._sum.amount ?? 0);
    const cashExpenses = Number(expenses._sum.amount ?? 0);
    return {
      businessDate: date,
      openingFloat,
      cashSales: round2(cashSales - cashRefunds),
      cashExpenses: round2(cashExpenses),
      expectedCash: expectedCash(
        openingFloat,
        cashSales,
        cashRefunds,
        cashExpenses,
      ),
    };
  }

  async closeDay(branchId: string, userId: string, dto: CashClosingDto) {
    const existing = await this.prisma.cashClosing.findUnique({
      where: {
        branchId_businessDate: {
          branchId,
          businessDate: dayStart(dto.businessDate),
        },
      },
    });
    if (existing) throw new BadRequestException('This day is already closed');
    const p = await this.closingPreview(
      branchId,
      dto.businessDate,
      dto.openingFloat,
    );
    return this.prisma.cashClosing.create({
      data: {
        branchId,
        businessDate: dayStart(dto.businessDate),
        openingFloat: dto.openingFloat,
        cashSales: p.cashSales,
        cashExpenses: p.cashExpenses,
        expectedCash: p.expectedCash,
        countedCash: dto.countedCash,
        variance: round2(dto.countedCash - p.expectedCash),
        note: dto.note,
        closedById: userId,
      },
    });
  }

  listClosings(branchId: string) {
    return this.prisma.cashClosing.findMany({
      where: { branchId },
      orderBy: { businessDate: 'desc' },
      take: 60,
    });
  }

  // --- Reports -------------------------------------------------------------

  /** Profit & loss for a period (cash-basis on bills paid in the period). */
  async profitAndLoss(branchId: string, from: string, to: string) {
    const f = dayStart(from);
    const t = dayAfter(to);
    const [orders, refunds, expenses, runs] = await Promise.all([
      this.prisma.order.aggregate({
        where: { branchId, status: 'PAID', billedAt: { gte: f, lt: t } },
        _sum: { totalAmount: true, tipAmount: true, taxAmount: true },
        _count: { _all: true },
      }),
      this.prisma.refund.aggregate({
        where: { createdAt: { gte: f, lt: t }, order: { branchId } },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { branchId, spentOn: { gte: f, lt: t } },
        _sum: { amount: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.payrollRun.findMany({
        where: {
          branchId,
          status: 'FINALIZED',
          periodEnd: { gte: f, lt: t },
        },
        include: { lines: true },
      }),
    ]);

    // Tips belong to staff, not the restaurant, so they are excluded from
    // revenue (and from payroll cost below).
    const collected =
      Number(orders._sum.totalAmount ?? 0) - Number(orders._sum.tipAmount ?? 0);
    const tax = Number(orders._sum.taxAmount ?? 0);
    const refunded = Number(refunds._sum.amount ?? 0);
    const netSales = round2(collected - tax - refunded);
    const expenseRows = expenses.map((e) => ({
      category: e.category,
      amount: round2(Number(e._sum.amount ?? 0)),
    }));
    const totalExpenses = round2(expenseRows.reduce((s, e) => s + e.amount, 0));
    const payrollCost = round2(
      runs
        .flatMap((r) => r.lines)
        .reduce(
          (s, l) => s + Number(l.basePay) - Number(l.unpaidLeaveDeduction),
          0,
        ),
    );
    return {
      from,
      to,
      orders: orders._count._all,
      grossCollected: round2(collected),
      taxCollected: round2(tax),
      refunds: round2(refunded),
      netSales,
      expenses: expenseRows,
      totalExpenses,
      payrollCost,
      netProfit: round2(netSales - totalExpenses - payrollCost),
    };
  }

  async gstReport(branchId: string, from: string, to: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: 'PAID',
        billedAt: { gte: dayStart(from), lt: dayAfter(to) },
      },
      select: {
        subtotal: true,
        discountAmount: true,
        loyaltyDiscountAmount: true,
        items: { select: { lineTotal: true, taxRateSnapshot: true } },
      },
    });
    const lines = orders.flatMap((o) => {
      const subtotal = Number(o.subtotal);
      const charged =
        subtotal - Number(o.discountAmount) - Number(o.loyaltyDiscountAmount);
      const factor = subtotal > 0 ? Math.max(0, charged) / subtotal : 1;
      return o.items.map((i) => ({
        lineTotal: Number(i.lineTotal),
        taxRatePercent: Number(i.taxRateSnapshot),
        factor,
      }));
    });
    return { from, to, orders: orders.length, ...gstSummary(lines) };
  }

  /** Cross-branch snapshot for the whole restaurant. */
  async branchOverview(restaurantId: string, from: string, to: string) {
    const f = dayStart(from);
    const t = dayAfter(to);
    const branches = await this.prisma.branch.findMany({
      where: { restaurantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return Promise.all(
      branches.map(async (b) => {
        const [sales, open, ingredients] = await Promise.all([
          this.prisma.order.aggregate({
            where: {
              branchId: b.id,
              status: 'PAID',
              billedAt: { gte: f, lt: t },
            },
            _sum: { totalAmount: true },
            _count: { _all: true },
          }),
          this.prisma.order.count({
            where: { branchId: b.id, status: 'OPEN' },
          }),
          this.prisma.ingredient.findMany({
            where: { branchId: b.id },
            select: {
              currentStock: true,
              reorderLevel: true,
              costPerUnit: true,
            },
          }),
        ]);
        return {
          branchId: b.id,
          name: b.name,
          orders: sales._count._all,
          sales: round2(Number(sales._sum.totalAmount ?? 0)),
          openOrders: open,
          lowStockItems: ingredients.filter(
            (i) =>
              Number(i.reorderLevel) > 0 &&
              Number(i.currentStock) <= Number(i.reorderLevel),
          ).length,
          inventoryValue: round2(
            ingredients.reduce(
              (s, i) => s + Number(i.currentStock) * Number(i.costPerUnit),
              0,
            ),
          ),
        };
      }),
    );
  }
}
