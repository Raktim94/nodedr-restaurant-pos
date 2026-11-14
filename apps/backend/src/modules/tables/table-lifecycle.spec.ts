import {
  TABLE_LIFECYCLE_STATES,
  TABLE_TRANSITIONS,
  canTransition,
  deriveTableState,
  mayCloseSession,
  type TableLifecycleFacts,
} from '@nodedr-restaurant/types';

const idle: TableLifecycleFacts = {
  sessionActive: false,
  accessVerified: false,
  openOrders: 0,
  ordersInKitchen: 0,
  paymentInFlight: false,
  awaitingPayment: false,
  attention: [],
  settledRecently: false,
};
const f = (o: Partial<TableLifecycleFacts>): TableLifecycleFacts => ({
  ...idle,
  ...o,
});

describe('deriveTableState', () => {
  it('an idle table is CLOSED', () =>
    expect(deriveTableState(idle).state).toBe('CLOSED'));
  it('a verified tap alone is ACCESS_VERIFIED, not OPEN: only the first order opens the table', () => {
    expect(deriveTableState(f({ accessVerified: true })).state).toBe(
      'ACCESS_VERIFIED',
    );
  });
  it('an open session with nothing ordered is OPEN', () =>
    expect(deriveTableState(f({ sessionActive: true })).state).toBe('OPEN'));
  it('food with the kitchen is ORDER_PROCESSING; served and unpaid is OPEN', () => {
    expect(
      deriveTableState(
        f({ sessionActive: true, openOrders: 1, ordersInKitchen: 1 }),
      ).state,
    ).toBe('ORDER_PROCESSING');
    expect(
      deriveTableState(f({ sessionActive: true, openOrders: 1 })).state,
    ).toBe('OPEN');
  });
  it('money expected is PAYMENT_PENDING, and outranks the kitchen', () => {
    expect(
      deriveTableState(
        f({ openOrders: 1, ordersInKitchen: 1, paymentInFlight: true }),
      ).state,
    ).toBe('PAYMENT_PENDING');
    expect(
      deriveTableState(f({ openOrders: 1, awaitingPayment: true })).state,
    ).toBe('PAYMENT_PENDING');
  });
  it('anything needing a person is ATTENTION_REQUIRED and outranks everything', () => {
    const r = deriveTableState(
      f({
        openOrders: 1,
        paymentInFlight: true,
        attention: ['Guests asked for the bill'],
      }),
    );
    expect(r.state).toBe('ATTENTION_REQUIRED');
    expect(r.reasons).toEqual(['Guests asked for the bill']);
  });
  it('a paid and cleared table is SETTLED for a while, then CLOSED; an open order is never SETTLED', () => {
    expect(deriveTableState(f({ settledRecently: true })).state).toBe(
      'SETTLED',
    );
    expect(
      deriveTableState(f({ settledRecently: true, openOrders: 1 })).state,
    ).toBe('OPEN');
  });
});

describe('transitions', () => {
  it('every state is reachable from CLOSED through legal steps', () => {
    const seen = new Set<string>(['CLOSED']);
    const queue = ['CLOSED'] as (typeof TABLE_LIFECYCLE_STATES)[number][];
    while (queue.length) {
      for (const n of TABLE_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect([...seen].sort()).toEqual([...TABLE_LIFECYCLE_STATES].sort());
  });
  it('rejects moves that skip the money: PAYMENT_PENDING never goes straight to ACCESS_VERIFIED, CLOSED never to SETTLED', () => {
    expect(canTransition('PAYMENT_PENDING', 'ACCESS_VERIFIED')).toBe(false);
    expect(canTransition('CLOSED', 'SETTLED')).toBe(false);
    expect(canTransition('SETTLED', 'PAYMENT_PENDING')).toBe(false);
  });
  it('allows the normal journey', () => {
    for (const [a, b] of [
      ['CLOSED', 'ACCESS_VERIFIED'],
      ['ACCESS_VERIFIED', 'ORDER_PROCESSING'],
      ['ORDER_PROCESSING', 'OPEN'],
      ['OPEN', 'PAYMENT_PENDING'],
      ['PAYMENT_PENDING', 'SETTLED'],
      ['SETTLED', 'CLOSED'],
    ] as const) {
      expect(canTransition(a, b)).toBe(true);
    }
  });
});

describe('mayCloseSession', () => {
  const ok = {
    openOrders: 0,
    paymentInFlight: false,
    awaitingPayment: false,
    attention: [] as string[],
  };
  it('closes only when nothing is owed and nothing is pending', () => {
    expect(mayCloseSession(ok)).toBe(true);
    expect(mayCloseSession({ ...ok, openOrders: 1 })).toBe(false);
    expect(mayCloseSession({ ...ok, paymentInFlight: true })).toBe(false);
    expect(mayCloseSession({ ...ok, awaitingPayment: true })).toBe(false);
    expect(
      mayCloseSession({ ...ok, attention: ['payment needs review'] }),
    ).toBe(false);
  });
});
