import { notificationListQuerySchema } from '@nodedr-restaurant/types';

describe('notificationListQuerySchema unreadOnly', () => {
  const parse = (q: Record<string, string>) =>
    notificationListQuerySchema.parse(q);

  it('treats the literal string "false" as false (z.coerce.boolean made it true)', () => {
    expect(parse({ unreadOnly: 'false' }).unreadOnly).toBe(false);
  });
  it('treats only the literal string "true" as true', () => {
    expect(parse({ unreadOnly: 'true' }).unreadOnly).toBe(true);
    expect(parse({ unreadOnly: '1' }).unreadOnly).toBe(false);
  });
  it('defaults to false and keeps pagination defaults', () => {
    const r = parse({});
    expect(r.unreadOnly).toBe(false);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });
});
