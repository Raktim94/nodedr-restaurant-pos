import { Injectable, Logger } from '@nestjs/common';
import type { SessionUser } from '@nodedr-restaurant/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeOrderTotals,
  priceLine,
  round2,
  toEffectiveInclusiveUnitPrice,
} from '../modules/orders/pricing';
import { OrdersService } from '../modules/orders/orders.service';
import type {
  OfflineSaleDto,
  OfflineSaleResult,
  OfflineSalesDto,
} from './standalone.schema';

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
        where: { branchId },
        orderBy: { sortOrder: 'asc' },
        include: {
          tables: { orderBy: { number: 'asc' }, select: { id: true, number: true, name: true, capacity: true } },
        },
      }),
      // Items that must have options chosen cannot be sold from the phone yet.
      this.prisma.menuItemModifierGroup.findMany({
        where: { modifierGroup: { branchId } },
        select: { menuItemId: true, modifierGroup: { select: { isRequired: true, minSelect: true } } },
      }),
    ]);
    const needsOptions = new Set(
      groupLinks
        .filter((l) => l.modifierGroup.isRequired || l.modifierGroup.minSelect > 0)
        .map((l) => l.menuItemId),
    );
    const r = branch.restaurant;
    return {
      generatedAt: new Date().toISOString(),
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
        results.push(await this.recordSale(user, branchId, sale, body.deviceName));
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Could not record this sale';
        this.logger.warn(`Offline sale ${sale.id} refused: ${reason}`);
        results.push({ id: sale.id, status: 'refused', reason });
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
      return { id: sale.id, status: 'duplicate', orderId: existing.id, orderNumber: existing.orderNumber };
    }
    if (existing) {
      // An earlier attempt left an unfinished order: do not settle it twice.
      throw new Error('An earlier attempt of this sale did not finish; it needs a look in Orders.');
    }

    // Merge repeated lines of the same dish so each can be matched to its price.
    const lines = new Map<string, { menuItemId: string; quantity: number; unitPrice: number }>();
    for (const l of sale.items) {
      const prev = lines.get(l.menuItemId);
      if (prev && prev.unitPrice !== l.unitPrice) {
        throw new Error('The same dish was sold at two different prices in one sale.');
      }
      lines.set(l.menuItemId, {
        menuItemId: l.menuItemId,
        quantity: (prev?.quantity ?? 0) + l.quantity,
        unitPrice: l.unitPrice,
      });
    }
    const merged = [...lines.values()];

    const note = [
      `Offline sale ${sale.localNumber}${deviceName ? ` on ${deviceName}` : ''}`,
      sale.tableLabel ? `(${sale.tableLabel})` : '',
      sale.note ?? '',
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
      } as never,
      { clientRequestId: sale.id, historical: { createdAt: new Date(sale.soldAt) } },
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
          discountReason: sale.discountPercent || sale.discountFlat ? 'Offline sale discount' : undefined,
          requestId: sale.id,
        } as never,
        mayExceedDiscountCap(user),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Payment could not be recorded';
      await this.prisma.order.updateMany({
        where: { id: order.id, status: 'OPEN' },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: `Offline sale could not be settled: ${reason}`.slice(0, 250),
        },
      });
      throw new Error(reason);
    }
    const done = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { id: true, orderNumber: true },
    });
    return { id: sale.id, status: 'created', orderId: done.id, orderNumber: done.orderNumber };
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
      const effective = toEffectiveInclusiveUnitPrice(raw, rate, branch.taxMode);
      return {
        item,
        raw,
        line: priceLine({ quantity: item.quantity, unitPriceInclusive: effective, taxRatePercent: rate }),
      };
    });
    const totals = computeOrderTotals(priced.map((p) => p.line));
    await this.prisma.$transaction([
      ...priced.map((p) =>
        this.prisma.orderItem.update({
          where: { id: p.item.id },
          data: { unitPriceSnapshot: round2(p.raw), lineTotal: p.line.lineTotal },
        }),
      ),
      this.prisma.order.update({
        where: { id: orderId },
        data: { subtotal: totals.subtotal, taxAmount: totals.taxAmount, totalAmount: totals.subtotal },
      }),
    ]);
  }
}
