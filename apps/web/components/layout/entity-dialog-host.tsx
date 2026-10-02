"use client";

import { useEffect, useState } from "react";
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog";
import { ReservationManageDialog } from "@/components/reservations/reservation-manage-dialog";
import { useBranch } from "@/hooks/use-branch";
import { useReservations } from "@/hooks/use-reservations";
import { onOpenEntity, type EntityKind } from "@/lib/entity-events";

// Mounted once in the app shell: opens the small manage window for whatever
// order/reservation a notification, toast or list row points at.
export function EntityDialogHost() {
  const { branchId } = useBranch();
  const [target, setTarget] = useState<{ kind: EntityKind; id: string } | null>(null);
  const { data: reservations } = useReservations(
    target?.kind === "Reservation" ? branchId : null,
  );

  useEffect(() => onOpenEntity((kind, id) => setTarget({ kind, id })), []);

  const close = (open: boolean) => {
    if (!open) setTarget(null);
  };

  return (
    <>
      <OrderDetailDialog
        branchId={branchId}
        orderId={target?.kind === "Order" ? target.id : null}
        open={target?.kind === "Order"}
        onOpenChange={close}
      />
      <ReservationManageDialog
        branchId={branchId}
        reservation={
          target?.kind === "Reservation"
            ? (reservations?.find((r) => r.id === target.id) ?? null)
            : null
        }
        open={target?.kind === "Reservation"}
        onOpenChange={close}
      />
    </>
  );
}
