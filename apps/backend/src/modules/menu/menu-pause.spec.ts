import { menuItemPauseSchema } from '@nodedr-restaurant/types';

describe('menu item pause request', () => {
  it.each([{ minutes: 30 }, { localTime: '13:10' }, { resume: true }])(
    'accepts %j',
    (input) => {
      expect(menuItemPauseSchema.parse(input)).toEqual(input);
    },
  );

  it.each([
    {},
    { minutes: 0 },
    { minutes: 1.5 },
    { minutes: 1441 },
    { localTime: '24:00' },
    { localTime: '13:60' },
    { resume: false },
    { resume: true, minutes: 30 },
  ])('rejects %j', (input) => {
    expect(menuItemPauseSchema.safeParse(input).success).toBe(false);
  });
});
