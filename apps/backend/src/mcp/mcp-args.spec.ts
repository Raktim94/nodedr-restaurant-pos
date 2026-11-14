import { Args } from './mcp-tools.builder';

describe('MCP tool argument checks (they bypass the REST Zod schemas, so they must be as strict)', () => {
  const a = (o: Record<string, unknown>) => new Args(o);
  it('quantities and counts are whole numbers in range', () => {
    expect(() => a({ items: [{ menuItemId: 'x', quantity: 1.5 }] }).items('items')).toThrow(/whole number/);
    expect(() => a({ items: [{ menuItemId: 'x', quantity: 0 }] }).items('items')).toThrow();
    expect(() => a({ items: [{ menuItemId: 'x', quantity: 1000 }] }).items('items')).toThrow();
    expect(a({ items: [{ menuItemId: 'x', quantity: 3 }] }).items('items')[0].quantity).toBe(3);
    expect(() => a({ guestCount: 0 }).int('guestCount', 1, 500)).toThrow();
    expect(a({ guestCount: 4 }).int('guestCount', 1, 500)).toBe(4);
  });
  it('money is not negative, has at most two decimals, and has a ceiling', () => {
    expect(() => a({ price: -1 }).money('price')).toThrow(/amount/);
    expect(() => a({ price: 10.999 }).money('price')).toThrow();
    expect(() => a({ price: 1e9 }).money('price')).toThrow();
    expect(a({ price: 249.5 }).money('price')).toBe(249.5);
    expect(a({}).optionalMoney('price')).toBeUndefined();
    expect(() => a({ amount: 0 }).positiveMoney('amount')).toThrow(/more than zero/);
    expect(() => a({ amount: -5 }).positiveMoney('amount')).toThrow();
    expect(a({ amount: 5 }).positiveMoney('amount')).toBe(5);
  });
});
