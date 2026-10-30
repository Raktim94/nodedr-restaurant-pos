/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- in-memory Prisma fake and jest mock calls are untyped by design */
// Runs the real IntegrationsService + OrdersService against an in-memory
// Prisma fake, so what is asserted is what actually gets written to / read
// from the order row — not what a mocked OrdersService was told.
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createIntegrationOrderSchema } from '@nodedr-restaurant/types';
import { OrdersService } from '../modules/orders/orders.service';
import {
  IntegrationKeyContext,
  IntegrationsService,
} from './integrations.service';

const dec = (v: number | string) => new Prisma.Decimal(v);

const BRANCH = 'b1';
const KEY: IntegrationKeyContext = {
  id: 'key-1',
  restaurantId: 'r1',
  branchId: BRANCH,
  scopes: ['orders:write', 'orders:read', 'orders:read_customer', 'menu:read'],
};

function build(opts: { zones?: boolean } = {}) {
  const orders: any[] = [];
  const menuItem = {
    id: 'm1',
    branchId: BRANCH,
    name: 'Margherita',
    price: dec(200),
    halfPrice: null,
    taxRatePercent: dec(5),
    isActive: true,
  };
  const customers: any[] = [];

  const tx = {
    order: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `o${orders.length + 1}`,
          status: 'OPEN',
          createdAt: new Date(),
          deliveryFee: dec(0),
          discountAmount: dec(0),
          loyaltyDiscountAmount: dec(0),
          scheduledFor: null,
          deliveryEtaAt: null,
          deliveredAt: null,
          deliveryStatus: null,
          deliveryAddress: null,
          deliveryPincode: null,
          deliveryPhone: null,
          ...data,
          items: data.items.create.map((i: any, n: number) => ({
            id: `i${n}`,
            menuItemId: i.menuItem.connect.id,
            nameSnapshot: i.nameSnapshot,
            unitPriceSnapshot: i.unitPriceSnapshot,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
            kitchenNote: i.kitchenNote ?? null,
            modifiers: [],
          })),
          kots: [],
          payments: [],
        };
        orders.push(row);
        return row;
      }),
    },
    table: { update: jest.fn() },
  };

  const prisma: any = {
    branch: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === BRANCH && where.restaurantId === 'r1'
          ? { id: BRANCH, name: 'Main' }
          : null,
      ),
      findUnique: jest.fn(async () => ({
        autoConfirmOrders: false,
        taxMode: 'INCLUSIVE',
      })),
    },
    customer: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          customers.find((c) =>
            where.id ? c.id === where.id : c.phone === where.phone,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const c = { id: `c${customers.length + 1}`, ...data };
        customers.push(c);
        return c;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          customers.find((c) => c.id === where.id),
          data,
        ),
      ),
    },
    userBranch: { findFirst: jest.fn(async () => ({ userId: 'staff-1' })) },
    menuItem: {
      findMany: jest.fn(async ({ where }: any) =>
        where.category ? [] : [menuItem],
      ),
    },
    modifier: { findMany: jest.fn(async () => []) },
    menuItemModifierGroup: { findMany: jest.fn(async () => []) },
    deliveryZone: {
      count: jest.fn(async () => (opts.zones ? 1 : 0)),
      findFirst: jest.fn(async () => ({
        id: 'z1',
        name: 'Central',
        fee: dec(40),
        minOrderAmount: dec(100),
        etaMinutes: 30,
      })),
    },
    order: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.orderNumber) return null; // nextOrderNumber
        const row = orders.find(
          (o) =>
            (!where.id || o.id === where.id) &&
            (!where.clientRequestId ||
              o.clientRequestId === where.clientRequestId) &&
            (!where.branchId || o.branchId === where.branchId) &&
            (!where.integrationKeyId ||
              o.integrationKeyId === where.integrationKeyId),
        );
        if (!row) return null;
        const customer = customers.find((c) => c.id === row.customerId);
        return { ...row, customer: customer ?? null };
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  const ordersService = new OrdersService(
    prisma,
    { emitToBranch: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { notifyByPermission: jest.fn() } as never,
    {} as never,
    { emitForBranch: jest.fn() } as never,
    {} as never,
  );
  const service = new IntegrationsService(
    prisma,
    ordersService,
    {} as never,
    {} as never,
  );
  return { service, prisma, orders, customers, tx };
}

const body = (over: Record<string, unknown> = {}) =>
  createIntegrationOrderSchema.parse({
    type: 'DELIVERY',
    customerName: 'Jane Doe',
    customerPhone: '+91 98765 43210',
    customerEmail: 'Jane@Example.com',
    delivery: { address: '12 MG Road, Flat 4B', pincode: '700001' },
    items: [{ menuItemId: 'm1', quantity: 2 }],
    ...over,
  });

describe('Integration API order flow', () => {
  it('persists the delivery address and phone, and the customer email', async () => {
    const { service, orders, customers } = build();
    await service.createOrder(KEY, BRANCH, body());
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      type: 'DELIVERY',
      channel: 'ONLINE',
      deliveryAddress: '12 MG Road, Flat 4B',
      deliveryPincode: '700001',
      // delivery.phone omitted -> falls back to the customer's mobile
      deliveryPhone: '+91 98765 43210',
      integrationKeyId: 'key-1',
    });
    expect(customers[0]).toMatchObject({
      phone: '+91 98765 43210',
      email: 'jane@example.com',
    });
  });

  it('persists them even when the location has no delivery zones', async () => {
    const { service, orders } = build({ zones: false });
    await service.createOrder(KEY, BRANCH, body());
    expect(orders[0].deliveryAddress).toBe('12 MG Road, Flat 4B');
  });

  it('returns customer mobile and delivery address with the personal-data scope', async () => {
    const { service } = build();
    const placed = await service.createOrder(KEY, BRANCH, body());
    const got: any = await service.getOrder(KEY, BRANCH, placed.id, true);
    expect(got.customer).toEqual({
      name: 'Jane Doe',
      phone: '+91 98765 43210',
      email: 'jane@example.com',
    });
    expect(got.delivery).toEqual({
      address: '12 MG Road, Flat 4B',
      pincode: '700001',
      phone: '+91 98765 43210',
    });
    expect(got).toMatchObject({
      status: 'OPEN',
      acceptance: 'PENDING',
      type: 'DELIVERY',
      fulfillment: { deliveryStatus: 'UNASSIGNED' },
    });
  });

  it('omits all customer data unless it is asked for', async () => {
    const { service } = build();
    const placed: any = await service.createOrder(KEY, BRANCH, body());
    const got: any = await service.getOrder(KEY, BRANCH, placed.id);
    for (const r of [placed, got]) {
      expect(r.customer).toBeUndefined();
      expect(r.delivery).toBeUndefined();
      const json = JSON.stringify(r);
      expect(json).not.toContain('98765');
      expect(json).not.toContain('MG Road');
      expect(json).not.toContain('jane@example.com');
    }
  });

  it('denies reading customer data without orders:read_customer', async () => {
    const { service } = build();
    const placed = await service.createOrder(KEY, BRANCH, body());
    const weak = { ...KEY, scopes: ['orders:read'] };
    await expect(
      service.getOrder(weak, BRANCH, placed.id, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not leak staff/loyalty fields from the underlying order row', async () => {
    const { service, customers } = build();
    const placed = await service.createOrder(KEY, BRANCH, body());
    customers[0].loyaltyPoints = 900;
    customers[0].allergies = 'peanuts';
    const got = await service.getOrder(KEY, BRANCH, placed.id, true);
    const json = JSON.stringify(got);
    expect(json).not.toContain('peanuts');
    expect(json).not.toContain('900');
    expect(json).not.toContain('staff-1');
    expect(got).not.toHaveProperty('createdById');
  });

  it('denies a key scoped to another location', async () => {
    const { service } = build();
    const placed = await service.createOrder(KEY, BRANCH, body());
    const other = { ...KEY, branchId: 'b2' };
    await expect(
      service.getOrder(other, BRANCH, placed.id, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createOrder(other, BRANCH, body()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s for an order another key placed, or one from another restaurant', async () => {
    const { service } = build();
    const placed = await service.createOrder(KEY, BRANCH, body());
    const otherKey = { ...KEY, id: 'key-2' };
    await expect(
      service.getOrder(otherKey, BRANCH, placed.id, true),
    ).rejects.toBeInstanceOf(NotFoundException);
    const otherTenant = { ...KEY, restaurantId: 'r2', branchId: null };
    await expect(
      service.getOrder(otherTenant, BRANCH, placed.id, true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prices on the server and ignores any amounts the caller sends', async () => {
    const { service, orders } = build({ zones: true });
    const dto = createIntegrationOrderSchema.parse({
      ...body(),
      totalAmount: 1,
      subtotal: 1,
      deliveryFee: 0,
      items: [{ menuItemId: 'm1', quantity: 2, unitPrice: 1, price: 1 }],
    });
    const res: any = await service.createOrder(KEY, BRANCH, dto);
    expect(orders[0].subtotal.toString()).toBe('400'); // 2 x 200, not 1
    expect(res.totals).toMatchObject({
      subtotal: 400,
      deliveryFee: 40, // from the zone, not the caller
      total: 440,
    });
    expect(res.items[0]).toMatchObject({ unitPrice: 200, lineTotal: 400 });
  });

  it('a retry with the same Idempotency-Key returns the original order', async () => {
    const { service, orders } = build();
    const a: any = await service.createOrder(
      KEY,
      BRANCH,
      body(),
      'retry-key-0001',
    );
    const b: any = await service.createOrder(
      KEY,
      BRANCH,
      body(),
      'retry-key-0001',
    );
    expect(orders).toHaveLength(1);
    expect(b.id).toBe(a.id);
    await service.createOrder(KEY, BRANCH, body(), 'retry-key-0002');
    expect(orders).toHaveLength(2);
  });

  it('refuses an Idempotency-Key reused with a different body', async () => {
    const { service, orders } = build();
    await service.createOrder(KEY, BRANCH, body(), 'mismatch-key-01');
    await expect(
      service.createOrder(
        KEY,
        BRANCH,
        body({ items: [{ menuItemId: 'm1', quantity: 3 }] }),
        'mismatch-key-01',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(orders).toHaveLength(1);
  });

  it('scopes idempotency keys to the API key', async () => {
    const { service, orders } = build();
    await service.createOrder(KEY, BRANCH, body(), 'shared-key-0001');
    await service.createOrder(
      { ...KEY, id: 'key-2' },
      BRANCH,
      body(),
      'shared-key-0001',
    );
    expect(orders).toHaveLength(2);
  });

  it('a concurrent duplicate (unique violation) resolves to the existing order', async () => {
    const { service, orders, tx } = build();
    const first: any = await service.createOrder(
      KEY,
      BRANCH,
      body(),
      'race-key-0001',
    );
    // The idempotency pre-check misses (race), the insert then collides.
    const real = (service as any).findOwnOrder.bind(service);
    const spy = jest
      .spyOn(service as any, 'findOwnOrder')
      .mockResolvedValueOnce(null)
      .mockImplementation(real);
    tx.order.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const again: any = await service.createOrder(
      KEY,
      BRANCH,
      body(),
      'race-key-0001',
    );
    spy.mockRestore();
    expect(again.id).toBe(first.id);
    expect(orders).toHaveLength(1);
  });
});
