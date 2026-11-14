import { Injectable, Logger } from '@nestjs/common';
import { permissionSatisfied, type SessionUser } from '@nodedr-restaurant/types';
import { allowedUnits, type StockUnit } from '../modules/inventory/units';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeOrderTotals,
  priceLine,
  round2,
  toEffectiveInclusiveUnitPrice,
} from '../modules/orders/pricing';
import { OrdersService } from '../modules/orders/orders.service';
import { StandaloneReservationsService } from './standalone-reservations.service';
import { resolveSoldAt } from './sold-at';
import type {
  OfflineSaleDto,
  OfflineSaleResult,
  OfflineSalesDto,
  RefusalCode,
  SaleReviewFlag,
} from './standalone.schema';

/** A refusal the phone can explain and act on, as opposed to an unexpected failure. */
class SaleRefused extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
  ) {
    super(message);
  }
}

// Owners and administrators are never capped; other roles need the explicit
// discounts.unlimited grant (same rule as the checkout screen).
function mayExceedDiscountCap(user: SessionUser): boolean {
  return (
    user.roleName === 'OWNER' ||
    user.roleName === 'ADMINISTRATOR' ||
    user.permissions.includes('discounts.unlimited')
  );
}

@Injectable()
export class StandaloneService {
  private readonly logger = new Logger(StandaloneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly bookings: StandaloneReservationsService,
  ) {}

  /** The menu, tables and settings a phone needs to sell with no connection. */
  async snapshot(user: SessionUser, branchId: string) {
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      include: { restaurant: true },
    });
    const [categories, items, floors, groupLinks] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { branchId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, sortOrder: true },
      }),
      this.prisma.menuItem.findMany({
        where: { branchId, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          categoryId: true,
          name: true,
          price: true,
          taxRatePercent: true,
          isVeg: true,
          isCombo: true,
        },
      }),
      this.prisma.floor.findMany({
        where: { branchId, isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          tables: {
            where: { hidden: false },
            orderBy: { number: 'asc' },
            select: { id: true, number: true, name: true, capacity: true },
          },
        },
      }),
      // Items that must have options chosen cannot be sold from the phone yet.
      this.prisma.menuItemModifierGroup.findMany({
        where: { modifierGroup: { branchId } },
        select: {
          menuItemId: true,
          modifierGroup: { select: { isRequired: true, minSelect: true } },
        },
      }),
    ]);
    const needsOptions = new Set(
      groupLinks
        .filter(
          (l) => l.modifierGroup.isRequired || l.modifierGroup.minSelect > 0,
        )
        .map((l) => l.menuItemId),
    );
    const r = branch.restaurant;
    // Bookings only for staff who may manage them; everyone else gets none.
    const reservations = user.permissions.includes('reservations.manage')
      ? await this.bookings.forSnapshot(branchId)
      : [];
    // Stock items for the Kitchen tab, only for staff who may record production and waste.
    const canKitchen = permissionSatisfied(user.permissions, 'production.record');
    const stockItems = canKitchen
      ? (
          await this.prisma.ingredient.findMany({
            where: { branchId, isActive: true },
            orderBy: [{ kind: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, unit: true, kind: true, conversions: true },
          })
        ).map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          kind: i.kind,
          units: allowedUnits(i.unit as StockUnit, i.conversions),
        }))
      : undefined;
    return {
      generatedAt: new Date().toISOString(),
      stockItems,
      canVoid: permissionSatisfied(user.permissions, 'production.void'),
      canReceive: permissionSatisfied(user.permissions, 'inventory.manage'),
      user: { id: user.id, name: user.name, permissions: user.permissions },
      restaurant: {
        name: r.name,
        currency: r.currency,
        timezone: r.timezone,
        upiVpa: r.upiVpa,
        upiPayeeName: r.upiPayeeName ?? r.name,
        maxManualDiscountPercent: Number(r.maxManualDiscountPercent),
      },
      branch: {
        id: branch.id,
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        gstNumber: branch.gstNumber,
        taxRegime: branch.taxRegime,
        taxMode: branch.taxMode,
        taxLabel: branch.taxLabel,
        taxId: branch.taxId,
        printerPaperWidthMm: branch.printerPaperWidthMm,
        printerColumns: branch.printerColumns,
      },
      categories,
      items: items.map((i) => ({
        id: i.id,
        categoryId: i.categoryId,
        name: i.name,
        price: Number(i.price),
        taxRate: Number(i.taxRatePercent),
        isVeg: i.isVeg,
        // Combos and items with required options need the full app.
        sellOffline: !needsOptions.has(i.id) && !i.isCombo,
      })),
      reservations,
      floors: floors.map((f) => ({
        id: f.id,
        name: f.name,
        tables: f.tables.map((t) => ({
          id: t.id,
          label: t.name ?? `Table ${t.number}`,
          capacity: t.capacity,
        })),
      })),
    };
  }

  /** Record sales taken offline. Safe to repeat: a sale is only ever recorded once. */
  async syncSales(
    user: SessionUser,
    branchId: string,
    body: OfflineSalesDto,
  ): Promise<{ results: OfflineSaleResult[] }> {
    const results: OfflineSaleResult[] = [];
    for (const sale of body.sales) {
      try {
        results.push(
          await this.recordSale(user, branchId, sale, body.deviceName),
        );
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : 'Could not record this sale';
        const code: RefusalCode =
          err instanceof SaleRefused ? err.code : 'OTHER';
        this.logger.warn(
          `Offline sale ${sale.id} refused (${code}): ${reason}`,
        );
        results.push({ id: sale.id, status: 'refused', code, reason });
      }
    }
    return { results };
  }

  private async recordSale(
    user: SessionUser,
    branchId: string,
    sale: OfflineSaleDto,
    deviceName?: string,
  ): Promise<OfflineSaleResult> {
    const existing = await this.prisma.order.findFirst({
      where: { branchId, clientRequestId: sale.id },
      select: { id: true, orderNumber: true, status: true },
    });
    if (existing && existing.status === 'PAID') {
      return {
        id: sale.id,
        status: 'duplicate',
        orderId: existing.id,
        orderNumber: existing.orderNumber,
      };
    }
    if (existing) {
      // An earlier attempt left an unfinished order: do not settle it twice.
      throw new SaleRefused(
        'ALREADY_STARTED',
        'An earlier attempt of this sale did not finish; it needs a look in Orders.',
      );
    }

    // The phone's clock is not trusted: see sold-at.ts.
    const when = resolveSoldAt(sale.soldAt);
    if (!when.ok) throw new SaleRefused('SALE_TOO_OLD', when.reason);

    // Merge repeated lines of the same dish so each can be matched to its price.
    const lines = new Map<
      string,
      { menuItemId: string; quantity: number; unitPrice: number }
    >();
    for (const l of sale.items) {
      const prev = lines.get(l.menuItemId);
      if (prev && prev.unitPrice !== l.unitPrice) {
        throw new SaleRefused(
          'PRICE_CONFLICT',
          'The same dish was sold at two different prices in one sale.',
        );
      }
      lines.set(l.menuItemId, {
        menuItemId: l.menuItemId,
        quantity: (prev?.quantity ?? 0) + l.quantity,
        unitPrice: l.unitPrice,
      });
    }
    const merged = [...lines.values()];

    // Conflicts with the server's current menu. A dish that is gone cannot be sold;
    // a price that moved is recorded as the customer paid it, and flagged.
    const current = await this.prisma.menuItem.findMany({
      where: { branchId, id: { in: merged.map((m) => m.menuItemId) } },
      select: { id: true, name: true, price: true, isActive: true },
    });
    const byId = new Map(current.map((c) => [c.id, c]));
    const gone = merged.filter((m) => !byId.get(m.menuItemId)?.isActive);
    if (gone.length) {
      const names = gone
        .map(
          (m) => byId.get(m.menuItemId)?.name ?? 'a dish that no longer exists',
        )
        .join(', ');
      throw new SaleRefused(
        'ITEM_UNAVAILABLE',
        `Not on the server's menu any more: ${names}.`,
      );
    }
    const review: SaleReviewFlag[] = merged.flatMap((m) => {
      const c = byId.get(m.menuItemId)!;
      return Math.abs(Number(c.price) - m.unitPrice) > 0.005
        ? [
            {
              type: 'PRICE_CHANGED' as const,
              menuItemId: m.menuItemId,
              name: c.name,
              phonePrice: m.unitPrice,
              serverPrice: Number(c.price),
            },
          ]
        : [];
    });

    const note = [
      `Offline sale ${sale.localNumber}${deviceName ? ` on ${deviceName}` : ''}`,
      sale.tableLabel ? `(${sale.tableLabel})` : '',
      sale.note ?? '',
      when.clamped
        ? `[Review: the phone's clock was ahead (it said ${sale.soldAt}); booked at the time the server received it]`
        : '',
      review.length
        ? `[Review: charged ${review.map((r) => `${r.name} ${r.phonePrice} (menu now ${r.serverPrice})`).join(', ')}]`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const order = await this.orders.createOrder(
      branchId,
      user.id,
      {
        type: sale.type,
        notes: note,
        items: merged.map((m) => ({
          menuItemId: m.menuItemId,
          quantity: m.quantity,
          modifierIds: [],
        })),
      },
      {
        clientRequestId: sale.id,
        historical: { createdAt: when.at },
      },
    );

    try {
      await this.applyOfflinePrices(branchId, order.id, merged);
      await this.orders.checkout(
        branchId,
        order.id,
        user.id,
        {
          payments: sale.payments,
          discountPercent: sale.discountPercent,
          discountFlat: sale.discountFlat,
          discountReason:
            sale.discountPercent || sale.discountFlat
              ? 'Offline sale discount'
              : undefined,
          requestId: sale.id,
        },
        mayExceedDiscountCap(user),
      );
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : 'Payment could not be recorded';
      await this.prisma.order.updateMany({
        where: { id: order.id, status: 'OPEN' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: `Offline sale could not be settled: ${reason}`.slice(
            0,
            250,
          ),
        },
      });
      throw new SaleRefused('PAYMENT_REJECTED', reason);
    }
    const done = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { id: true, orderNumber: true },
    });
    return {
      id: sale.id,
      status: 'created',
      orderId: done.id,
      orderNumber: done.orderNumber,
      ...(review.length ? { review } : {}),
    };
  }

  /**
   * The customer paid the price on the phone's screen, not today's menu price,
   * so the order's lines are set to the prices they were actually charged.
   */
  private async applyOfflinePrices(
    branchId: string,
    orderId: string,
    lines: { menuItemId: string; quantity: number; unitPrice: number }[],
  ) {
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { taxMode: true },
    });
    const items = await this.prisma.orderItem.findMany({ where: { orderId } });
    const priced = items.map((item) => {
      const sold = lines.find((l) => l.menuItemId === item.menuItemId);
      const raw = sold ? sold.unitPrice : Number(item.unitPriceSnapshot);
      const rate = Number(item.taxRateSnapshot);
      const effective = toEffectiveInclusiveUnitPrice(
        raw,
        rate,
        branch.taxMode,
      );
      return {
        item,
        raw,
        line: priceLine({
          quantity: item.quantity,
          unitPriceInclusive: effective,
          taxRatePercent: rate,
        }),
      };
    });
    const totals = computeOrderTotals(priced.map((p) => p.line));
    await this.prisma.$transaction([
      ...priced.map((p) =>
        this.prisma.orderItem.update({
          where: { id: p.item.id },
          data: {
            unitPriceSnapshot: round2(p.raw),
            lineTotal: p.line.lineTotal,
          },
        }),
      ),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.subtotal,
        },
      }),
    ]);
  }
}
