"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useCancelOrder } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api";

const REASONS = ["Guest left", "Wrong order", "Duplicate order", "Out of stock"];

// Replaces the browser confirm(): that dialog is silently suppressed on
// kiosk/PWA tablets, which made "Cancel order" look like it did nothing.
export function CancelOrderDialog({
  branchId,
  orderId,
  orderNumber,
  open,
  onOpenChange,
  onCancelled,
}: {
  branchId: string | null;
  orderId: string;
  orderNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled?: () => void;
}) {
  const [reason, setReason] = useState("");
  const cancel = useCancelOrder(branchId);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    cancel.mutate(
      { orderId, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason("");
          onOpenChange(false);
          onCancelled?.();
        },
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : "Could not cancel the order. Try again."),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Cancel order #{orderNumber}?</DialogTitle>
            <DialogDescription>
              The kitchen tickets are withdrawn and the table is freed. Nothing has been paid or taken
              from stock yet. The order stays in History with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              required
              autoFocus
              placeholder="Why is this order cancelled?"
            />
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <Button key={r} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setReason(r)}>
                  {r}
                </Button>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Keep order
            </Button>
            <Button type="submit" variant="destructive" disabled={cancel.isPending || reason.trim().length === 0}>
              {cancel.isPending ? "Cancelling…" : "Cancel order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Whether the signed-in user may cancel orders (cashiers and waiters may not). */
export function useCanCancelOrders() {
  const { data: me } = useCurrentUser();
  return hasPermission(me?.user, "orders.cancel");
}
