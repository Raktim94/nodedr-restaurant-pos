// Which TanStack Query caches a realtime push must refresh. Order and table
// events refresh the "orders" family too (open bill per table, bill detail,
// orders list): without that, a second terminal that changed a bill left the
// first terminal showing a stale or missing order for the table.
export function realtimeInvalidations(event: string, branchId: string): string[][] {
  switch (event) {
    case "kot.created":
    case "kot.updated":
      return [["kds"], ["dashboard"], ["orders"]];
    case "kot.reprinted":
      return [["kds"], ["orders"]];
    case "table.updated":
    case "table.layout.updated":
      return [["floors", branchId], ["orders"]];
    case "order.created":
    case "order.updated":
    case "order.deleted":
      // ["kds"]: incoming orders waiting to be accepted, and tickets that a
      // cancel/decline/payment changed, live on the kitchen screen too.
      return [["dashboard"], ["floors", branchId], ["orders"], ["kds"]];
    case "reservation.created":
    case "reservation.updated":
      return [["reservations", branchId], ["dashboard"]];
    default:
      return [];
  }
}

export const REALTIME_EVENTS = [
  "kot.created",
  "kot.updated",
  "kot.reprinted",
  "table.updated",
  "table.layout.updated",
  "order.created",
  "order.updated",
  "order.deleted",
  "reservation.created",
  "reservation.updated",
] as const;
