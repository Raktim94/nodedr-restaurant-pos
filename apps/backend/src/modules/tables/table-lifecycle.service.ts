import { Injectable } from '@nestjs/common';
import {
  TABLE_LIFECYCLE_STATES,
  deriveTableState,
  type TableLifecycleFacts,
  type TableLifecycleState,
} from '@nodedr-restaurant/types';
import { PrismaService } from '../../prisma/prisma.service';

const SETTLED_WINDOW_MS = 15 * 60_000;
const IN_FLIGHT_MS = 30 * 60_000;

/**
 * The live table board. Every state is derived from stored facts (sessions, orders, kitchen tickets, payments, calls)
 * by the shared state machine in @nodedr-restaurant/types; nothing here is typed in by hand and nothing is stored,
 * so the board cannot drift from the orders. Batched queries: a floor of 100 tables costs a fixed handful of reads.
 */
@Injectable()
export class TableLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(branchId: string) {
    const now = Date.now();
    const tables = await this.prisma.table.findMany({
      where: { floor: { branchId }, hidden: false },
      select: {
        id: true,
        number: true,
        name: true,
        capacity: true,
        floor: { select: { id: true, name: true } },
      },
      orderBy: [{ floor: { name: 'asc' } }, { number: 'asc' }],
    });
    const ids = tables.map((t) => t.id);
    const [orders, sessions, accesses, requests, paid] = await Promise.all([
      this.prisma.order.findMany({
        where: { branchId, status: 'OPEN', tableId: { in: ids } },
        select: {
          id: true,
          tableId: true,
          totalAmount: true,
          heldForPayment: true,
          payIntent: true,
          guestName: true,
          createdAt: true,
          updatedAt: true,
          kots: { select: { status: true } },
        },
      }),
      this.prisma.tableSession.findMany({
        where: { branchId, status: 'ACTIVE', tableId: { in: ids } },
        select: {
          tableId: true,
          openedAt: true,
          openedVia: true,
          expiresAt: true,
        },
      }),
      this.prisma.tableAccess.groupBy({
        by: ['tableId'],
        where: { tableId: { in: ids }, expiresAt: { gt: new Date() } },
        _count: { _all: true },
      }),
      this.prisma.tableRequest.findMany({
        where: { branchId, resolvedAt: null, tableId: { in: ids } },
        select: { tableId: true, type: true },
      }),
      this.prisma.order.groupBy({
        by: ['tableId'],
        where: {
          branchId,
          status: 'PAID',
          tableId: { in: ids },
          updatedAt: { gt: new Date(now - SETTLED_WINDOW_MS) },
        },
        _max: { updatedAt: true },
      }),
    ]);
    const orderIds = orders.map((o) => o.id);
    const payments = orderIds.length
      ? await this.prisma.gatewayPayment.findMany({
          where: {
            orderId: { in: orderIds },
            status: { in: ['CREATED', 'FAILED', 'NEEDS_REVIEW'] },
          },
          select: { orderId: true, status: true, createdAt: true },
        })
      : [];

    const rows = tables.map((t) => {
      const mine = orders.filter((o) => o.tableId === t.id);
      const myPayments = payments.filter((p) =>
        mine.some((o) => o.id === p.orderId),
      );
      const attention: string[] = [];
      for (const r of requests.filter((x) => x.tableId === t.id))
        attention.push(
          r.type === 'BILL'
            ? 'Guests asked for the bill'
            : 'Guests called the waiter',
        );
      if (myPayments.some((p) => p.status === 'NEEDS_REVIEW'))
        attention.push(
          'A payment needs review: money was taken but the order could not be settled',
        );
      if (myPayments.some((p) => p.status === 'FAILED'))
        attention.push('An online payment failed');
      const session = sessions.find((s) => s.tableId === t.id);
      const facts: TableLifecycleFacts = {
        sessionActive:
          !!session && (session.expiresAt.getTime() > now || mine.length > 0),
        accessVerified:
          (accesses.find((a) => a.tableId === t.id)?._count._all ?? 0) > 0,
        openOrders: mine.length,
        ordersInKitchen: mine.filter((o) =>
          o.kots.some((k) =>
            ['NEW', 'ACCEPTED', 'PREPARING', 'READY'].includes(k.status),
          ),
        ).length,
        paymentInFlight: myPayments.some(
          (p) =>
            p.status === 'CREATED' &&
            now - p.createdAt.getTime() < IN_FLIGHT_MS,
        ),
        awaitingPayment: mine.some(
          (o) => o.heldForPayment && o.payIntent === 'ONLINE',
        ),
        attention,
        settledRecently: paid.some((p) => p.tableId === t.id),
      };
      const reading = deriveTableState(facts);
      const last = Math.max(
        0,
        ...mine.map((o) => o.updatedAt.getTime()),
        session?.openedAt.getTime() ?? 0,
      );
      return {
        id: t.id,
        number: t.number,
        name: t.name,
        capacity: t.capacity,
        floorId: t.floor.id,
        floor: t.floor.name,
        state: reading.state,
        reasons: reading.reasons,
        orderCount: mine.length,
        billTotal: mine
          .reduce((sum, o) => sum + Number(o.totalAmount), 0)
          .toFixed(2),
        guestCount: new Set(mine.map((o) => o.guestName).filter(Boolean)).size,
        sessionOpenedAt: session?.openedAt ?? null,
        openedVia: session?.openedVia ?? null,
        lastActivityAt: last ? new Date(last) : null,
      };
    });
    const counts = Object.fromEntries(
      TABLE_LIFECYCLE_STATES.map((s) => [s, 0]),
    ) as Record<TableLifecycleState, number>;
    for (const r of rows) counts[r.state]++;
    return {
      generatedAt: new Date().toISOString(),
      counts,
      activeSessions: sessions.length,
      activeOrders: orders.length,
      tables: rows,
    };
  }
}
