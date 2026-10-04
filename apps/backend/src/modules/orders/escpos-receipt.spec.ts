import { buildOpenDrawer, buildReceiptEscPos } from './escpos-receipt';

const DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
const base = {
  restaurantName: 'Test Cafe',
  currency: 'INR',
  branch: {
    name: 'Main',
    address: null,
    phone: null,
    gstNumber: null,
    taxRegime: 'INDIA_GST' as const,
    taxMode: 'INCLUSIVE' as const,
    taxLabel: null,
    taxId: null,
  },
  order: {
    orderNumber: '1',
    createdAt: new Date('2026-10-04T10:00:00Z').toISOString(),
    type: 'TAKEAWAY',
    tableLabel: null,
    items: [],
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 0,
    tipAmount: 0,
    totalAmount: 100,
    payments: [{ method: 'CASH', amount: 100 }],
  },
};

describe('cash drawer', () => {
  it('open-drawer is init + the standard pulse', () => {
    expect(buildOpenDrawer().subarray(-5).equals(DRAWER)).toBe(true);
  });

  it('only kicks the drawer when asked', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const without = buildReceiptEscPos(base as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withKick = buildReceiptEscPos({ ...(base as any), openDrawer: true });
    expect(without.includes(DRAWER)).toBe(false);
    expect(withKick.subarray(-5).equals(DRAWER)).toBe(true);
    expect(withKick.length).toBe(without.length + 5);
  });
});
