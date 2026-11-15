import {
  LineConflict,
  checkLine,
  lineKey,
  mergeLines,
  normalisePhone,
  type MenuFacts,
  type ModifierFacts,
} from './offline-lines';

const menu = new Map<string, MenuFacts>([
  [
    'pizza',
    {
      name: 'Pizza',
      price: 300,
      halfPrice: 180,
      isActive: true,
      groupIds: new Set(['g1']),
    },
  ],
  [
    'tea',
    {
      name: 'Tea',
      price: 20,
      halfPrice: null,
      isActive: true,
      groupIds: new Set(),
    },
  ],
  [
    'old',
    {
      name: 'Old dish',
      price: 50,
      halfPrice: null,
      isActive: false,
      groupIds: new Set(),
    },
  ],
]);
const mods = new Map<string, ModifierFacts>([
  [
    'cheese',
    {
      name: 'Extra cheese',
      priceAdjustment: 40,
      isActive: true,
      groupId: 'g1',
    },
  ],
  [
    'olive',
    { name: 'Olives', priceAdjustment: 25, isActive: true, groupId: 'g1' },
  ],
  [
    'gone',
    { name: 'Gone', priceAdjustment: 10, isActive: false, groupId: 'g1' },
  ],
  [
    'other',
    { name: 'Elsewhere', priceAdjustment: 5, isActive: true, groupId: 'g9' },
  ],
]);

describe('offline lines', () => {
  it('keys a line by dish, portion and add-ons in any order', () => {
    expect(lineKey({ menuItemId: 'p', modifierIds: ['b', 'a'] })).toBe(
      lineKey({ menuItemId: 'p', modifierIds: ['a', 'b'] }),
    );
    expect(
      lineKey({ menuItemId: 'p', portion: 'HALF', modifierIds: [] }),
    ).not.toBe(lineKey({ menuItemId: 'p', modifierIds: [] }));
  });

  it('merges the same dish with the same add-ons, keeps different ones apart, and joins notes', () => {
    const m = mergeLines([
      {
        menuItemId: 'pizza',
        quantity: 1,
        unitPrice: 340,
        modifierIds: ['cheese'],
        note: 'well done',
      },
      {
        menuItemId: 'pizza',
        quantity: 2,
        unitPrice: 340,
        modifierIds: ['cheese'],
        note: 'no onion',
      },
      { menuItemId: 'pizza', quantity: 1, unitPrice: 300, modifierIds: [] },
    ]);
    expect(m).toHaveLength(2);
    const cheese = m.find((x) => x.modifierIds.length)!;
    expect(cheese.quantity).toBe(3);
    expect(cheese.note).toBe('well done; no onion');
  });

  it('refuses one line at two prices', () => {
    expect(() =>
      mergeLines([
        { menuItemId: 'tea', quantity: 1, unitPrice: 20, modifierIds: [] },
        { menuItemId: 'tea', quantity: 1, unitPrice: 25, modifierIds: [] },
      ]),
    ).toThrow(LineConflict);
  });

  it('prices half portions and add-ons from the server menu', () => {
    const [l] = mergeLines([
      {
        menuItemId: 'pizza',
        quantity: 1,
        unitPrice: 245,
        modifierIds: ['olive', 'cheese'],
        portion: 'HALF',
      },
    ]);
    expect(checkLine(l, menu, mods)).toEqual({
      ok: true,
      menuPrice: 245,
      label: 'Pizza (Half) + Extra cheese, Olives',
    });
  });

  it('says what is gone: a dish off, no half portion, an add-on off or not offered for that dish', () => {
    const one = (x: Parameters<typeof mergeLines>[0][0]) =>
      checkLine(mergeLines([x])[0], menu, mods);
    expect(
      one({ menuItemId: 'old', quantity: 1, unitPrice: 50, modifierIds: [] }),
    ).toEqual({ ok: false, reason: 'Old dish' });
    expect(
      one({ menuItemId: 'nope', quantity: 1, unitPrice: 50, modifierIds: [] })
        .ok,
    ).toBe(false);
    expect(
      one({
        menuItemId: 'tea',
        quantity: 1,
        unitPrice: 10,
        modifierIds: [],
        portion: 'HALF',
      }),
    ).toEqual({ ok: false, reason: 'Tea (half portion)' });
    expect(
      one({
        menuItemId: 'pizza',
        quantity: 1,
        unitPrice: 310,
        modifierIds: ['gone'],
      }),
    ).toEqual({ ok: false, reason: 'Gone on Pizza' });
    expect(
      one({
        menuItemId: 'pizza',
        quantity: 1,
        unitPrice: 305,
        modifierIds: ['other'],
      }),
    ).toEqual({ ok: false, reason: 'Elsewhere on Pizza' });
  });

  it('treats spaced and dashed phone numbers as one', () => {
    expect(normalisePhone('98765 43210')).toBe('9876543210');
    expect(normalisePhone('+91 98765-43210')).toBe('+919876543210');
  });
});
