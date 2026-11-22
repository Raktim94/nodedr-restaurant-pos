/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- hand-built Prisma/jest mocks */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- hand-built Prisma rows */
import { OrdersService } from './orders.service';

const svc = () =>
  new OrdersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

const menuItem = {
  id: 'm1',
  name: 'Pizza',
  price: 100,
  halfPrice: null,
  taxRatePercent: 10,
} as never;
const modifier = {
  id: 'x1',
  name: 'Extra cheese',
  priceAdjustment: 20,
} as never;

const lineFor = (taxMode: 'INCLUSIVE' | 'EXCLUSIVE') =>
  (svc() as any).buildLine(
    { menuItemId: 'm1', quantity: 1, modifierIds: ['x1'] },
    new Map([['m1', menuItem]]),
    new Map([['x1', modifier]]),
    taxMode,
    false,
  );

describe('unitPriceSnapshot', () => {
  it('reconciles qty x rate to the line total in INCLUSIVE mode', () => {
    const line = lineFor('INCLUSIVE');
    expect(line.priced.lineTotal).toBe(120);
    expect(line.menuItem.price).toBe(120); // was 100
    expect(line.menuItem.price * 1).toBe(line.priced.lineTotal);
  });

  it('reconciles qty x rate to the line total in EXCLUSIVE mode', () => {
    const line = lineFor('EXCLUSIVE');
    expect(line.priced.lineTotal).toBe(132);
    expect(line.menuItem.price).toBe(132); // was 112
    expect(line.menuItem.price * 1).toBe(line.priced.lineTotal);
  });
});
