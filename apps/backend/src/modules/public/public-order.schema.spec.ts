import { publicOrderSchema } from '@nodedr-restaurant/types';

describe('public order schema', () => {
  const basket = {
    guestName: 'Asha',
    items: [{ menuItemId: 'm1', quantity: 1, modifierIds: [] }],
  };

  it('accepts an ordinary guest basket', () => {
    expect(publicOrderSchema.parse(basket)).toMatchObject(basket);
  });

  it('strips staff-only portion and custom pricing fields', () => {
    const parsed = publicOrderSchema.parse({
      ...basket,
      items: [
        {
          ...basket.items[0],
          portion: 'HALF',
          customPrice: 1,
          customLabel: 'half',
        },
      ],
    });
    expect(parsed.items[0]).toEqual(basket.items[0]);
  });
});
