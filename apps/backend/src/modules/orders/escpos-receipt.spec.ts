import { readJob } from './escpos/read-job';
import {
  buildKotEscPosJob,
  buildOpenDrawer,
  buildReceiptEscPos,
  buildReceiptEscPosJob,
  buildTestSlip,
  resolveProfile,
} from './escpos-receipt';

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
    const without = buildReceiptEscPos(base as any);

    const withKick = buildReceiptEscPos({ ...(base as any), openDrawer: true });
    expect(without.includes(DRAWER)).toBe(false);
    expect(withKick.subarray(-5).equals(DRAWER)).toBe(true);
    expect(withKick.length).toBe(without.length + 5);
  });
});

// ---------------------------------------------------------------------------
// Full-job tests: receipt and kitchen ticket content, 58/80 mm layout, code
// page behaviour. Bytes are decoded with readJob() (see escpos/read-job.ts).
// Paper output on a physical printer is NOT covered here - see the docs.
// ---------------------------------------------------------------------------

const order = {
  orderNumber: '20261018-0042',
  createdAt: new Date('2026-10-18T10:30:00Z'),
  type: 'DINE_IN',
  table: { label: 'T7' },
  customer: null,
  subtotal: 31.4,
  discountAmount: 0,
  taxAmount: 2.85,
  tipAmount: 0,
  loyaltyPointsRedeemed: 0,
  loyaltyDiscountAmount: 0,
  totalAmount: 31.4,
  items: [
    {
      nameSnapshot: 'Paella Valenciana con mariscos y azafrán de La Mancha',
      quantity: 2,
      unitPriceSnapshot: 12.5,
      lineTotal: 25,
      taxRateSnapshot: 10,
      modifiers: [{ nameSnapshot: 'Sin gluten', priceAdjSnapshot: 0 }],
    },
    {
      nameSnapshot: 'Crema Catalana',
      quantity: 1,
      unitPriceSnapshot: 6.4,
      lineTotal: 6.4,
      taxRateSnapshot: 10,
      modifiers: [],
    },
  ],
  payments: [{ method: 'CARD', amount: 31.4 }],
};
const branch = {
  name: 'Casa Ñandú',
  address: 'Calle Mayor 1, Madrid',
  phone: null,
  gstNumber: null,
  taxRegime: 'ES_IVA' as const,
  taxMode: 'INCLUSIVE' as const,
  taxLabel: null,
  taxId: 'B12345678',
};
const fmt = { timeZone: 'UTC', locale: 'en-GB' };

describe('receipt job', () => {
  it.each([
    [58, 32],
    [80, 48],
  ])('prints a %i mm bill inside %i columns with native text', (mm, cols) => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa Ñandú',
      currency: 'EUR',
      branch,
      order,
      profile: resolveProfile({ paperWidthMm: mm }),
      ...fmt,
    });
    const { lines, text } = readJob(job.buffer);
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(cols));
    expect(job.unsupportedChars).toEqual([]);
    // the long name wraps across lines but loses nothing
    expect(text.replace(/\n/g, ' ')).toContain(
      'Paella Valenciana con mariscos y azafrán de La Mancha',
    );
    expect(text).toContain('+ Sin gluten');
    expect(text).toContain('2 x €12.50');
    expect(text).toContain('€25.00');
    expect(text).toContain('IVA');
    const total = lines.find((l) => l.startsWith('TOTAL'))!;
    expect(total.endsWith('€31.40')).toBe(true);
    expect(total).toHaveLength(cols); // value flush right at the last column
    expect(text).toContain('18/10/2026');
    // a bitmap job would contain GS v 0 / ESC * raster commands
    expect(job.buffer.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(false);
    expect(job.buffer.includes(Buffer.from([0x1b, 0x2a]))).toBe(false);
  });

  it('falls back to "EUR" on a code page that has no euro sign', () => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa',
      currency: 'EUR',
      branch,
      order,
      profile: resolveProfile({ codepage: 'CP437' }),
      ...fmt,
    });
    const { text } = readJob(job.buffer, 'CP437');
    expect(text).toContain('EUR 31.40');
    expect(text).not.toContain('?');
  });

  it('flags unprintable item names instead of silently mangling them', () => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa',
      currency: 'EUR',
      branch,
      order: {
        ...order,
        items: [{ ...order.items[1], nameSnapshot: 'ラーメン Ramen' }],
      },
      ...fmt,
    });
    expect(job.unsupportedChars.length).toBeGreaterThan(0);
    expect(readJob(job.buffer).text).toContain('could not be printed');
  });

  it('ends with a full style reset and a cut', () => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa',
      currency: 'EUR',
      branch,
      order,
      ...fmt,
    });
    const { commands } = readJob(job.buffer);
    expect(commands.slice(-6)).toEqual([
      '1d2100',
      '1b4500',
      '1b2d00',
      '1d4200',
      '1b6100',
      '1d5600',
    ]);
  });
});

describe('kitchen ticket job', () => {
  const kot = {
    orderNumber: '20261018-0042',
    type: 'DINE_IN',
    createdAt: new Date('2026-10-18T10:30:00Z'),
    table: { label: 'T7' },
    customer: null,
    items: [
      {
        nameSnapshot: 'Paella Valenciana',
        quantity: 2,
        kitchenNote: 'Sin azafrán, alergia',
        modifiers: [{ nameSnapshot: 'Sin gluten' }],
      },
      {
        nameSnapshot: 'Crema Catalana',
        quantity: 1,
        kitchenNote: null,
        modifiers: [],
      },
    ],
  };

  it('has order, type, table, time, quantities, modifiers and notes - and no money', () => {
    const job = buildKotEscPosJob({
      branchName: 'Casa Ñandú',
      order: kot,
      ...fmt,
    });
    const { text } = readJob(job.buffer);
    expect(text).toContain('#20261018-0042');
    expect(text).toContain('DINE IN - Table T7');
    expect(text).toContain('18/10/2026');
    expect(text).toContain('2 x Paella Valenciana');
    expect(text).toContain('+ Sin gluten');
    expect(text).toContain('NOTE: Sin azafrán, alergia');
    expect(text).toContain('1 x Crema Catalana');
    expect(text).toContain('2 line(s), 3 item(s)');
    expect(text).not.toMatch(/[€$]|TOTAL|IVA|Subtotal|Paid|\d\.\d{2}/);
  });

  it('wraps a long note on 58 mm paper', () => {
    const job = buildKotEscPosJob({
      branchName: 'Casa',
      order: {
        ...kot,
        items: [
          {
            ...kot.items[0],
            kitchenNote:
              'sin cebolla, sin ajo, salsa aparte y muy poco hecho por favor',
          },
        ],
      },
      profile: resolveProfile({ paperWidthMm: 58 }),
      ...fmt,
    });
    readJob(job.buffer).lines.forEach((l) =>
      expect(l.length).toBeLessThanOrEqual(32),
    );
  });
});

describe('test slip', () => {
  it('prints a column ruler and the code page sample', () => {
    const { text } = readJob(
      buildTestSlip(resolveProfile({ paperWidthMm: 58 })),
    );
    expect(text).toContain('12345678901234567890123456789012');
    expect(text).toContain('58 mm - 32 columns - CP858');
    expect(text).toContain('áéíóú ñ ü ¿? ¡! € £');
  });
});
