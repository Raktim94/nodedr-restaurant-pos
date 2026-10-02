// Lets anything in the dashboard (a notification, a toast, a list row) ask
// the always-mounted <EntityDialogHost /> to pop open the manage window for
// an order or reservation, without threading state through every page.
export type EntityKind = "Order" | "Reservation";

const EVENT = "pos:open-entity";

export function openEntity(kind: EntityKind, id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { kind, id } }));
}

export function onOpenEntity(handler: (kind: EntityKind, id: string) => void) {
  const listener = (e: Event) => {
    const { kind, id } = (e as CustomEvent<{ kind: EntityKind; id: string }>).detail;
    handler(kind, id);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
