// Table lifecycle: what state a table is in, derived by the SERVER from facts it holds (sessions, orders, kitchen
// tickets, payments, requests). A screen never decides a state and nobody sets one by hand; there is no stored
// "state" column to drift out of step with the orders. `TRANSITIONS` lists the moves that can legitimately happen
// between two readings, so tests and the dashboard can tell a normal change from an impossible one.

export const TABLE_LIFECYCLE_STATES = [
  "CLOSED", // nobody is being served
  "ACCESS_VERIFIED", // a guest has proven they are at the table (tag tap or code), nothing ordered yet
  "OPEN", // a session is active, orders exist or may be placed, nothing is waiting on the kitchen or on money
  "ORDER_PROCESSING", // at least one open order still has food the kitchen has not finished
  "PAYMENT_PENDING", // money is expected: an online payment is in flight or an order is held until it is paid
  "SETTLED", // the last order was paid and the table was cleared a moment ago
  "ATTENTION_REQUIRED", // a person must look: guest call, bill request, failed or unclear payment
] as const;
export type TableLifecycleState = (typeof TABLE_LIFECYCLE_STATES)[number];

export interface TableLifecycleFacts {
  /** A table session is live (active, and either unexpired or still carrying an unpaid order). */
  sessionActive: boolean;
  /** At least one unexpired verified-access token exists for this table. */
  accessVerified: boolean;
  openOrders: number;
  /** Open orders with at least one kitchen ticket that is not yet served. */
  ordersInKitchen: number;
  /** A gateway payment for an open order is in flight. */
  paymentInFlight: boolean;
  /** An open order is held until the guest pays online. */
  awaitingPayment: boolean;
  /** Reasons a person must look (guest calls, failed or unclear payments). Empty = none. */
  attention: string[];
  /** The last order at this table was paid within the settled window and nothing is open. */
  settledRecently: boolean;
}

export interface TableLifecycleReading {
  state: TableLifecycleState;
  reasons: string[];
}

export function deriveTableState(f: TableLifecycleFacts): TableLifecycleReading {
  if (f.attention.length > 0) return { state: "ATTENTION_REQUIRED", reasons: f.attention };
  if (f.openOrders > 0) {
    if (f.paymentInFlight) return { state: "PAYMENT_PENDING", reasons: ["An online payment is in progress"] };
    if (f.awaitingPayment) return { state: "PAYMENT_PENDING", reasons: ["An order is held until it is paid online"] };
    if (f.ordersInKitchen > 0) return { state: "ORDER_PROCESSING", reasons: [`${f.ordersInKitchen} order${f.ordersInKitchen === 1 ? "" : "s"} with the kitchen`] };
    return { state: "OPEN", reasons: ["Served; waiting for the bill"] };
  }
  if (f.sessionActive) return { state: "OPEN", reasons: ["Session open, nothing ordered yet"] };
  if (f.accessVerified) return { state: "ACCESS_VERIFIED", reasons: ["A guest tapped the table tag; the first order opens the table"] };
  if (f.settledRecently) return { state: "SETTLED", reasons: ["Paid and cleared"] };
  return { state: "CLOSED", reasons: [] };
}

const ALL_ACTIVE: TableLifecycleState[] = ["OPEN", "ORDER_PROCESSING", "PAYMENT_PENDING", "ATTENTION_REQUIRED"];

/** Moves between two successive readings that can happen in normal operation. Anything else points at a bug or a manual override. */
export const TABLE_TRANSITIONS: Record<TableLifecycleState, TableLifecycleState[]> = {
  CLOSED: ["ACCESS_VERIFIED", "OPEN", "ORDER_PROCESSING", "ATTENTION_REQUIRED"], // OPEN: staff opened it; ORDER_PROCESSING: staff or POS order
  ACCESS_VERIFIED: ["CLOSED", "OPEN", "ORDER_PROCESSING", "PAYMENT_PENDING", "ATTENTION_REQUIRED"], // access expired, or the first order arrived
  OPEN: ["CLOSED", "SETTLED", ...ALL_ACTIVE.filter((s) => s !== "OPEN")],
  ORDER_PROCESSING: ["CLOSED", "SETTLED", ...ALL_ACTIVE.filter((s) => s !== "ORDER_PROCESSING")],
  PAYMENT_PENDING: ["SETTLED", "CLOSED", ...ALL_ACTIVE.filter((s) => s !== "PAYMENT_PENDING")], // a failed payment goes back to a working state
  SETTLED: ["CLOSED", "ACCESS_VERIFIED", "OPEN", "ORDER_PROCESSING", "ATTENTION_REQUIRED"],
  ATTENTION_REQUIRED: ["CLOSED", "SETTLED", ...ALL_ACTIVE.filter((s) => s !== "ATTENTION_REQUIRED")],
};

export function canTransition(from: TableLifecycleState, to: TableLifecycleState): boolean {
  return from === to || TABLE_TRANSITIONS[from].includes(to);
}

/** A table session is closed only when every order is settled and no money is pending. An expiry timer alone never closes it. */
export function mayCloseSession(f: Pick<TableLifecycleFacts, "openOrders" | "paymentInFlight" | "awaitingPayment" | "attention">): boolean {
  return f.openOrders === 0 && !f.paymentInFlight && !f.awaitingPayment && f.attention.length === 0;
}
