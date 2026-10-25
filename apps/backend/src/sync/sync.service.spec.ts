import { SyncChange, SyncService } from './sync.service';

const ch = (
  pkKey: string,
  ts: string,
  op: 'U' | 'D' = 'U',
  tbl = 'menu_items',
): SyncChange => ({
  tbl,
  pk: { id: pkKey },
  pkKey,
  op,
  row: op === 'U' ? { id: pkKey } : null,
  ts,
});

describe('SyncService.compact', () => {
  it('keeps only the newest change per row', () => {
    const out = SyncService.compact([
      ch('a', '2026-01-01T00:00:00.000Z'),
      ch('a', '2026-01-01T00:00:02.000Z', 'D'),
      ch('a', '2026-01-01T00:00:01.000Z'),
      ch('b', '2026-01-01T00:00:00.000Z'),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.pkKey === 'a')?.op).toBe('D');
  });

  it('treats the same key in different tables as different rows', () => {
    const out = SyncService.compact([
      ch('a', '2026-01-01T00:00:00.000Z', 'U', 'orders'),
      ch('a', '2026-01-01T00:00:00.000Z', 'U', 'tables'),
    ]);
    expect(out).toHaveLength(2);
  });
});
