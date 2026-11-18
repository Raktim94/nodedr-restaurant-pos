import { Injectable, Logger } from '@nestjs/common';
import {
  permissionSatisfied,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { allowedUnits } from '../modules/inventory/units';
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
import {
  LineConflict,
  checkLine,
  lineKey,
  mergeLines,
  normalisePhone,
  type MenuFacts,
  type MergedLine,
  type ModifierFacts,
} from './offline-lines';
import type {
  OfflineSaleDto,
  OfflineSaleResult,
  OfflineSalesDto,
  RefusalCode,
  SaleReviewFlag,
} from './standalone.schema';

/** Marks a pay-later sale saved open on purpose, so a re-send is answered as a duplicate. */
const PAY_LATER_MARK = '[Pay later: balance due from the customer]';

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
    const [categories, items, floors, staffRows] = await Promise.all([
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
          halfPrice: true,
          taxRatePercent: true,
          isVeg: true,
          isCombo: true,
          barcode: true,
          sku: true,
          modifierGroups: {
            orderBy: { sortOrder: 'asc' },
            select: {
              modifierGroup: {
                select: {
                  id: true,
                  name: true,
                  minSelect: true,
                  maxSelect: true,
                  isRequired: true,
                  modifiers: {
                    where: { isActive: true },
                    orderBy: { sortOrder: 'asc' },
                    select: {
                      id: true,
                      name: true,
                      priceAdjustment: true,
                      isDefault: true,
                    },
                  },
                },
              },
            },
          },
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
      // Staff who can sell on this branch: a shared phone lets each switch in with their own PIN (set on the phone).
      this.prisma.user.findMany({
        where: {
          restaurantId: user.restaurantId,
          isActive: true,
          branches: { some: { branchId } },
        },
        orderBy: { name: 'asc' },
        take: 200,
        select: {
          id: true,
          name: true,
          role: {
            select: {
              name: true,
              label: true,
              permissions: {
                select: { permission: { select: { key: true } } },
              },
            },
          },
        },
      }),
    ]);
    const r = branch.restaurant;
    // Bookings only for staff who may manage them; everyone else gets none.
    const reservations = user.permissions.includes('reservations.manage')
      ? await this.bookings.forSnapshot(branchId)
      : [];
    // Stock items for the Kitchen tab, only for staff who may record production and waste.
    const canKitchen = permissionSatisfied(
      user.permissions,
      'production.record',
    );
    const stockItems = canKitchen
      ? (
          await this.prisma.ingredient.findMany({
            where: { branchId, isActive: true },
            orderBy: [{ kind: 'asc' }, { name: 'asc' }],
            select: {
              id: true,
              name: true,
              unit: true,
              kind: true,
              conversions: true,
            },
          })
        ).map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          kind: i.kind,
          units: allowedUnits(i.unit, i.conversions),
        }))
      : undefined;
    // Places stock is kept in, for moving stock on the phone (names only).
    const stockPlaces = canKitchen
      ? await this.prisma.stockLocation.findMany({
          where: { branchId, isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true },
        })
      : undefined;
    return {
      generatedAt: new Date().toISOString(),
      stockItems,
      stockPlaces,
      // What this account may do in the Stock journal on the phone. Only decides which buttons the phone shows;
      // the server checks the same permission again on every request.
      stockCaps: canKitchen
        ? {
            record: true,
            post: permissionSatisfied(user.permissions, 'production.post'),
            recipes: permissionSatisfied(user.permissions, 'inventory.manage'),
            inventoryItems: permissionSatisfied(
              user.permissions,
              'inventory.manage',
            ),
            menuItems:
              permissionSatisfied(user.permissions, 'inventory.manage') &&
              permissionSatisfied(user.permissions, 'menu.manage'),
            report: permissionSatisfied(user.permissions, 'production.report'),
          }
        : undefined,
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
        requireDiscountReason: r.requireDiscountReason,
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
      staff: staffRows.map((u) => {
        const perms = u.role.permissions.map((p) => p.permission.key);
        return {
          id: u.id,
          name: u.name,
          role: u.role.label || u.role.name,
          // May approve discounts, refunds and cash on a shared phone.
          manager:
            u.role.name === 'OWNER' ||
            u.role.name === 'ADMINISTRATOR' ||
            permissionSatisfied(perms, 'refunds.process') ||
            permissionSatisfied(perms, 'discounts.unlimited'),
        };
      }),
      items: items.map((i) => ({
        id: i.id,
        categoryId: i.categoryId,
        name: i.name,
        price: Number(i.price),
        halfPrice: i.halfPrice == null ? null : Number(i.halfPrice),
        taxRate: Number(i.taxRatePercent),
        isVeg: i.isVeg,
        barcode: i.barcode || null,
        sku: i.sku || null,
        options: i.modifierGroups
          .map((g) => g.modifierGroup)
          .filter((g) => g.modifiers.length > 0)
          .map((g) => ({
            id: g.id,
            name: g.name,
            min: g.isRequired ? Math.max(1, g.minSelect) : g.minSelect,
            max: Math.max(g.maxSelect, 1),
            choices: g.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
              price: Number(m.priceAdjustment),
              isDefault: m.isDefault,
            })),
          })),
        // Combos need the full app (their parts are chosen there).
        sellOffline: !i.isCombo,
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
      select: {
        id: true,
        orderNumber: true,
        status: true,
        notes: true,
        _count: { select: { payments: true } },
      },
    });
    // Recorded already: paid, or a pay-later sale that was saved open on purpose (its note says so).
    if (
      existing &&
      (existing.status === 'PAID' ||
        (existing.status === 'OPEN' &&
          existing.notes?.includes(PAY_LATER_MARK)))
    ) {
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

    // One line per dish + portion + add-ons; repeats merged.
    let merged: MergedLine[];
    try {
      merged = mergeLines(sale.items);
    } catch (e) {
      if (e instanceof LineConflict)
        throw new SaleRefused('PRICE_CONFLICT', e.message);
      throw e;
    }

    // The server's menu today: dishes, their option groups, and the add-ons named on the phone.
    const menuRows = await this.prisma.menuItem.findMany({
      where: {
        branchId,
        id: { in: [...new Set(merged.map((m) => m.menuItemId))] },
      },
      select: {
        id: true,
        name: true,
        price: true,
        halfPrice: true,
        isActive: true,
        modifierGroups: { select: { modifierGroupId: true } },
      },
    });
    const menu = new Map<string, MenuFacts>(
      menuRows.map((r) => [
        r.id,
        {
          name: r.name,
          price: Number(r.price),
          halfPrice: r.halfPrice == null ? null : Number(r.halfPrice),
          isActive: r.isActive,
          groupIds: new Set(r.modifierGroups.map((g) => g.modifierGroupId)),
        },
      ]),
    );
    const modIds = [...new Set(merged.flatMap((m) => m.modifierIds))];
    const modRows = modIds.length
      ? await this.prisma.modifier.findMany({
          where: { id: { in: modIds }, group: { branchId } },
          select: {
            id: true,
            name: true,
            priceAdjustment: true,
            isActive: true,
            groupId: true,
          },
        })
      : [];
    const modifiers = new Map<string, ModifierFacts>(
      modRows.map((m) => [
        m.id,
        {
          name: m.name,
          priceAdjustment: Number(m.priceAdjustment),
          isActive: m.isActive,
          groupId: m.groupId,
        },
      ]),
    );
    // A dish (or portion, or add-on) that is gone cannot be sold; a price that moved is recorded as the customer
    // paid it, and flagged.
    const checked = merged.map((m) => ({
      line: m,
      check: checkLine(m, menu, modifiers),
    }));
    const gone = checked.filter((c) => !c.check.ok);
    if (gone.length) {
      throw new SaleRefused(
        'ITEM_UNAVAILABLE',
        `Not on the server's menu any more: ${gone
          .map((g) => (g.check.ok ? '' : g.check.reason))
          .join(', ')}.`,
      );
    }
    const priced = checked.map((c) => ({
      ...c.line,
      menuPrice: (c.check as { menuPrice: number }).menuPrice,
      label: (c.check as { label: string }).label,
    }));

    // The phone's prices and discounts are a claim, not authority. Selling below the menu price, or typing a
    // discount, is a discount like any other: the normal checkout needs discounts.apply for it and applies the
    // restaurant's cap, so the offline route does the same. (A waiter's phone with a price that went stale after
    // a menu increase is refused with the current price; a manager can enter that sale.)
    const mayDiscount =
      user.permissions.includes('discounts.apply') ||
      mayExceedDiscountCap(user);
    if ((sale.discountPercent || sale.discountFlat) && !mayDiscount) {
      throw new SaleRefused(
        'DISCOUNT_NOT_ALLOWED',
        'This account may not give discounts. Ask a manager to enter this sale.',
      );
    }
    const below = priced.filter((m) => m.unitPrice < m.menuPrice - 0.005);
    if (below.length && !mayDiscount) {
      const names = below
        .map(
          (m) =>
            `${m.label} (menu price ${m.menuPrice}, sold at ${m.unitPrice})`,
        )
        .join(', ');
      throw new SaleRefused(
        'DISCOUNT_NOT_ALLOWED',
        `Sold below the menu price and this account may not give discounts: ${names}. Ask a manager to enter this sale.`,
      );
    }
    if (
      !mayExceedDiscountCap(user) &&
      (below.length || sale.discountPercent || sale.discountFlat)
    ) {
      // The cap covers everything that lowers the price: selling under the menu price AND any typed discount, added
      // together (a price just under the cap plus a typed discount up to the cap must not pass as two small discounts).
      const cap = Number(
        (
          await this.prisma.branch.findUniqueOrThrow({
            where: { id: branchId },
            select: {
              restaurant: { select: { maxManualDiscountPercent: true } },
            },
          })
        ).restaurant.maxManualDiscountPercent,
      );
      const menuTotal = priced.reduce(
        (a, m) => a + m.menuPrice * m.quantity,
        0,
      );
      const soldTotal = priced.reduce(
        (a, m) => a + m.unitPrice * m.quantity,
        0,
      );
      const priceCut =
        menuTotal > 0
          ? Math.max(0, ((menuTotal - soldTotal) / menuTotal) * 100)
          : 0;
      const typed =
        (sale.discountPercent ?? 0) +
        (menuTotal > 0 ? ((sale.discountFlat ?? 0) / menuTotal) * 100 : 0);
      const total = priceCut + typed;
      if (total > cap + 0.005) {
        throw new SaleRefused(
          'DISCOUNT_NOT_ALLOWED',
          `Together the price cut and discount come to ${total.toFixed(1)}% below the menu price; this restaurant allows ${cap}% for this account. Ask a manager to enter this sale.`,
        );
      }
    }
    // A restaurant that requires a reason for discounts requires it here too: the reason comes from the phone, it is
    // not made up by the server (that used to satisfy the policy for every offline discount).
    const discountReason = sale.discountReason?.trim() || undefined;
    if (
      (below.length || sale.discountPercent || sale.discountFlat) &&
      !discountReason
    ) {
      const policy = await this.prisma.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { restaurant: { select: { requireDiscountReason: true } } },
      });
      if (policy.restaurant.requireDiscountReason) {
        throw new SaleRefused(
          'DISCOUNT_NOT_ALLOWED',
          'This restaurant needs a reason for every discount. Add a reason and send the sale again.',
        );
      }
    }
    const review: SaleReviewFlag[] = priced.flatMap((m) =>
      Math.abs(m.menuPrice - m.unitPrice) > 0.005
        ? [
            {
              type: 'PRICE_CHANGED' as const,
              menuItemId: m.menuItemId,
              name: m.label,
              phonePrice: m.unitPrice,
              serverPrice: m.menuPrice,
            },
          ]
        : [],
    );

    // Who the bill is for: the same phone number is the same customer.
    const customerId = sale.customer
      ? await this.customerFor(branchId, sale.customer)
      : undefined;

    // Who took it: a staff member switched in on a shared phone, if they really work here; otherwise the account
    // that is syncing.
    let takenBy: { id: string; name: string } | null = null;
    if (sale.takenByUserId && sale.takenByUserId !== user.id) {
      takenBy = await this.prisma.user.findFirst({
        where: {
          id: sale.takenByUserId,
          restaurantId: user.restaurantId,
          isActive: true,
        },
        select: { id: true, name: true },
      });
    }

    const note = [
      `Offline sale ${sale.localNumber}${deviceName ? ` on ${deviceName}` : ''}`,
      sale.tableLabel ? `(${sale.tableLabel})` : '',
      sale.note ?? '',
      takenBy ? `[Taken by ${takenBy.name}, synced by ${user.name}]` : '',
      sale.tipAmount
        ? `[Voluntary service charge ${sale.tipAmount}, booked as tip]`
        : '',
      sale.payLater ? PAY_LATER_MARK : '',
      below.length && discountReason
        ? `[Discount reason: ${discountReason}]`
        : '',
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
      takenBy?.id ?? user.id,
      {
        type: sale.type,
        notes: note,
        ...(customerId ? { customerId } : {}),
        items: priced.map((m) => ({
          menuItemId: m.menuItemId,
          quantity: m.quantity,
          modifierIds: m.modifierIds,
          ...(m.portion ? { portion: m.portion } : {}),
          ...(m.note ? { kitchenNote: m.note } : {}),
        })),
      },
      {
        clientRequestId: sale.id,
        historical: { createdAt: when.at },
      },
    );

    try {
      await this.applyOfflinePrices(branchId, order.id, priced);
      const hasAdjustments =
        !!sale.discountPercent || !!sale.discountFlat || !!sale.tipAmount;
      if (sale.payments.length > 0 || hasAdjustments) {
        // A pay-later sale with nothing paid still fixes its discount and service charge on the order; the server
        // needs one payment for that, so with no money taken those figures are only on the bill note until paid.
        if (sale.payments.length > 0) {
          await this.orders.checkout(
            branchId,
            order.id,
            user.id,
            {
              payments: sale.payments,
              discountPercent: sale.discountPercent,
              discountFlat: sale.discountFlat,
              tipAmount: sale.tipAmount,
              discountReason:
                sale.discountPercent || sale.discountFlat
                  ? (discountReason ?? 'Offline sale discount')
                  : undefined,
              ...(customerId ? { customerId } : {}),
              allowPartial: sale.payLater || undefined,
              requestId: sale.id,
            },
            mayExceedDiscountCap(user),
          );
        } else {
          await this.fixUnpaidBill(branchId, order.id, sale, discountReason);
        }
      }
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

  /** The customer with this phone number on the branch, made if there is none. */
  private async customerFor(
    branchId: string,
    c: { name?: string; phone: string },
  ): Promise<string> {
    const phone = normalisePhone(c.phone);
    const found = await this.prisma.customer.findFirst({
      where: { branchId, phone: { in: [...new Set([phone, c.phone.trim()])] } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (found) {
      if (!found.name && c.name) {
        await this.prisma.customer.update({
          where: { id: found.id },
          data: { name: c.name },
        });
      }
      return found.id;
    }
    const made = await this.prisma.customer.create({
      data: { branchId, phone, name: c.name || null },
      select: { id: true },
    });
    return made.id;
  }

  /**
   * A pay-later sale with nothing paid yet: the discount and service charge the guest was given still belong on the
   * bill, so the amount owed on the server is what the phone showed.
   */
  private async fixUnpaidBill(
    branchId: string,
    orderId: string,
    sale: OfflineSaleDto,
    discountReason?: string,
  ) {
    const o = await this.prisma.order.findFirstOrThrow({
      where: { id: orderId, branchId },
      select: { subtotal: true },
    });
    const subtotal = Number(o.subtotal);
    const pct = sale.discountPercent ?? 0;
    const discountAmount = round2(
      Math.min((subtotal * pct) / 100 + (sale.discountFlat ?? 0), subtotal),
    );
    const tip = round2(sale.tipAmount ?? 0);
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        discountAmount,
        tipAmount: tip,
        totalAmount: round2(subtotal - discountAmount + tip),
        ...(discountAmount > 0
          ? {
              discountType: pct ? 'PERCENT' : 'FIXED',
              discountValue: pct || (sale.discountFlat ?? 0),
              discountReason: discountReason ?? 'Offline sale discount',
            }
          : {}),
      },
    });
  }

  /**
   * The customer paid the price on the phone's screen, not today's menu price, so lines charged at another price are
   * set to what they were actually charged. Lines at the menu price are left exactly as the server priced them.
   */
  private async applyOfflinePrices(
    branchId: string,
    orderId: string,
    lines: (MergedLine & { menuPrice: number })[],
  ) {
    const differs = lines.filter(
      (l) => Math.abs(l.unitPrice - l.menuPrice) > 0.005,
    );
    if (!differs.length) return;
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { taxMode: true },
    });
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      include: {
        modifiers: { select: { modifierId: true, priceAdjSnapshot: true } },
      },
    });
    const byKey = new Map(differs.map((l) => [l.key, l]));
    const repriced = items.map((item) => {
      const rate = Number(item.taxRateSnapshot);
      const modTotal = round2(
        item.modifiers.reduce((a, m) => a + Number(m.priceAdjSnapshot), 0),
      );
      const sold = byKey.get(
        lineKey({
          menuItemId: item.menuItemId,
          portion: item.portion,
          modifierIds: item.modifiers.map((m) => m.modifierId),
        }),
      );
      // Same arithmetic as OrdersService.buildLine: the snapshot is the inclusive unit price without add-ons.
      const unitInclusive = sold
        ? toEffectiveInclusiveUnitPrice(sold.unitPrice, rate, branch.taxMode)
        : round2(Number(item.unitPriceSnapshot) + modTotal);
      return {
        item,
        changed: !!sold,
        snapshot: round2(unitInclusive - modTotal),
        line: priceLine({
          quantity: item.quantity,
          unitPriceInclusive: unitInclusive,
          taxRatePercent: rate,
        }),
      };
    });
    const totals = computeOrderTotals(repriced.map((p) => p.line));
    await this.prisma.$transaction([
      ...repriced
        .filter((p) => p.changed)
        .map((p) =>
          this.prisma.orderItem.update({
            where: { id: p.item.id },
            data: {
              unitPriceSnapshot: p.snapshot,
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
