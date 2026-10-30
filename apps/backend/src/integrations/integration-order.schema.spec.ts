import {
  createIntegrationOrderSchema,
  integrationIdempotencyKeySchema,
} from '@nodedr-restaurant/types';

const valid = {
  type: 'DELIVERY',
  customerName: 'Jane Doe',
  customerPhone: '+91 98765 43210',
  delivery: { address: '12 MG Road', pincode: '700001' },
  items: [{ menuItemId: 'm1', quantity: 1 }],
};

describe('createIntegrationOrderSchema', () => {
  it('accepts a complete delivery order and normalises the email', () => {
    const r = createIntegrationOrderSchema.safeParse({
      ...valid,
      customerEmail: ' Jane@Example.COM ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.customerEmail).toBe('jane@example.com');
  });

  it.each([
    ['delivery without an address', { delivery: undefined }],
    ['a bad phone', { customerPhone: '<script>' }],
    ['a bad email', { customerEmail: 'nope' }],
    ['no items', { items: [] }],
    ['too many items', { items: Array(51).fill(valid.items[0]) }],
    ['a zero quantity', { items: [{ menuItemId: 'm1', quantity: 0 }] }],
    ['a huge quantity', { items: [{ menuItemId: 'm1', quantity: 1000 }] }],
    ['an unknown order type', { type: 'DINE_IN' }],
    ['oversized notes', { notes: 'x'.repeat(501) }],
    ['a non-ISO time', { scheduledFor: 'tomorrow' }],
  ])('rejects %s', (_label, over) => {
    expect(
      createIntegrationOrderSchema.safeParse({ ...valid, ...over }).success,
    ).toBe(false);
  });

  it('allows a takeaway order with no address', () => {
    expect(
      createIntegrationOrderSchema.safeParse({
        ...valid,
        type: 'TAKEAWAY',
        delivery: undefined,
      }).success,
    ).toBe(true);
  });

  it('strips money fields the caller should not control', () => {
    const r = createIntegrationOrderSchema.parse({
      ...valid,
      totalAmount: 1,
      deliveryFee: 0,
      items: [{ menuItemId: 'm1', quantity: 1, price: 1, customPrice: 1 }],
    });
    expect(r).not.toHaveProperty('totalAmount');
    expect(r).not.toHaveProperty('deliveryFee');
    expect(r.items[0]).not.toHaveProperty('price');
    expect(r.items[0]).not.toHaveProperty('customPrice');
  });
});

describe('integrationIdempotencyKeySchema', () => {
  it('accepts uuid-like keys and rejects short or odd ones', () => {
    expect(
      integrationIdempotencyKeySchema.safeParse(
        '2f1a9a52-6c1c-4a39-9b0e-3f9e0f4c6d11',
      ).success,
    ).toBe(true);
    expect(integrationIdempotencyKeySchema.safeParse('short').success).toBe(
      false,
    );
    expect(
      integrationIdempotencyKeySchema.safeParse('has space in it').success,
    ).toBe(false);
  });
});
