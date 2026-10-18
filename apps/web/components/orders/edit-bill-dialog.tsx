"use client";

import { Minus, Trash2 } from "lucide-react";
import { useState } from "react";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useOrder,
  useRemoveOrderItem,
  useUpdateOrder,
  useUpdateOrderItem,
} from "@/hooks/use-orders";
import { useFloors } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

const KITCHEN_STARTED = new Set(["PREPARING", "READY", "SERVED"]);

// Corrections on an UNPAID bill: lower/remove a line (while the kitchen has
// not started it), move to another table, fix guest details. Paid bills are
// never edited in place - use Refund so the money and audit trail stay intact.
export function EditBillDialog({
  branchId,
  orderId,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: order, isLoading } = useOrder(branchId, open ? orderId : null);
  const { data: floors } = useFloors(branchId);
  const updateOrder = useUpdateOrder(branchId);
  const updateItem = useUpdateOrderItem(branchId);
  const removeItem = useRemoveOrderItem(branchId);
  const { note, clear: clearNote, toast } = useNoteToast();
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [guestName, setGuestName] = useState<string | null>(null);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "That change could not be saved.");
  const editable = order?.status === "OPEN";
  const startedItems = new Set(
    (order?.kots ?? [])
      .filter((k) => KITCHEN_STARTED.has(k.status))
      .flatMap((k) => k.items.map((i) => i.orderItemId))
      .concat(
        (order?.kots ?? []).flatMap((k) =>
          k.items.filter((i) => KITCHEN_STARTED.has(i.status)).map((i) => i.orderItemId),
        ),
      ),
  );
  const freeTables = (floors ?? [])
    .flatMap((f) => f.tables)
    .filter((t) => t.id !== order?.tableId && t.status === "AVAILABLE");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setRemoving(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit bill {order ? `#${order.orderNumber}` : ""}</DialogTitle>
          <DialogDescription>
            Totals and tax update automatically. Every change is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !order ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : !editable ? (
          <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
            {order.status === "PAID"
              ? "This bill is paid, so it can't be edited. Use Refund to correct it."
              : "Only open bills can be edited."}
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {order.items.map((item) => {
                const locked = startedItems.has(item.id);
                return (
                  <div key={item.id} className="flex flex-col gap-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.quantity}× {item.nameSnapshot}
                        </p>
                        {item.modifiers.length > 0 && (
                          <p className="truncate text-xs text-muted-foreground">
                            {item.modifiers.map((m) => m.nameSnapshot).join(", ")}
                          </p>
                        )}
                        {locked && (
                          <p className="text-xs text-warning">Kitchen has started this — can&apos;t change it</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="mr-2 text-sm tabular-nums">{formatCurrency(item.lineTotal)}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`One fewer ${item.nameSnapshot}`}
                          disabled={locked || item.quantity <= 1 || updateItem.isPending}
                          onClick={() => {
                            setError(null);
                            updateItem.mutate(
                              { orderId, itemId: item.id, quantity: item.quantity - 1 },
                              { onError: fail },
                            );
                          }}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          aria-label={`Remove ${item.nameSnapshot}`}
                          disabled={locked || order.items.length < 2}
                          onClick={() => {
                            setError(null);
                            setReason("");
                            setRemoving(item.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {removing === item.id && (
                      <form
                        className="flex flex-col gap-2 rounded-lg bg-destructive/5 p-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          removeItem.mutate(
                            { orderId, itemId: item.id, reason: reason.trim() },
                            {
                              onSuccess: () => {
                                toast.success(`${item.nameSnapshot} removed from the bill`);
                                setRemoving(null);
                              },
                              onError: fail,
                            },
                          );
                        }}
                      >
                        <Label htmlFor={`rm-${item.id}`} className="text-xs">
                          Remove {item.quantity}× {item.nameSnapshot}? Reason
                        </Label>
                        <Input
                          id={`rm-${item.id}`}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={200}
                          required
                          autoFocus
                          placeholder="e.g. guest changed their mind"
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => setRemoving(null)}>
                            Keep
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            variant="destructive"
                            disabled={removeItem.isPending || reason.trim().length === 0}
                          >
                            {removeItem.isPending ? "Removing…" : "Remove item"}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              To add more food, use <span className="font-medium text-foreground">Add another round</span> so the
              kitchen gets a new ticket.
            </p>

            <div className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total (incl. {formatCurrency(order.taxAmount)} tax)</span>
              <span className="font-semibold tabular-nums">{formatCurrency(order.totalAmount)}</span>
            </div>

            {order.type === "DINE_IN" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="move-table">Move to another table</Label>
                <select
                  id="move-table"
                  className="h-10 w-full min-w-0 truncate rounded-lg border border-input bg-background px-3 text-sm"
                  value=""
                  disabled={updateOrder.isPending || freeTables.length === 0}
                  onChange={(e) => {
                    const tableId = e.target.value;
                    if (!tableId) return;
                    setError(null);
                    updateOrder.mutate(
                      { orderId, dto: { tableId } },
                      {
                        onSuccess: () => toast.success("Bill moved — both tables updated"),
                        onError: fail,
                      },
                    );
                  }}
                >
                  <option value="">
                    {freeTables.length === 0
                      ? "No free table available"
                      : `Currently ${order.table ? (order.table.name ?? `Table ${order.table.number}`) : "no table"} — choose a free table`}
                  </option>
                  {freeTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name ?? `Table ${t.number}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                updateOrder.mutate(
                  {
                    orderId,
                    dto: {
                      guestName: (guestName ?? order.guestName ?? "").trim() || null,
                      notes: (notes ?? order.notes ?? "").trim() || null,
                    },
                  },
                  { onSuccess: () => toast.success("Bill details saved"), onError: fail },
                );
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bill-guest">Guest name</Label>
                <Input
                  id="bill-guest"
                  value={guestName ?? order.guestName ?? ""}
                  maxLength={80}
                  onChange={(e) => setGuestName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bill-notes">Note</Label>
                <Input
                  id="bill-notes"
                  value={notes ?? order.notes ?? ""}
                  maxLength={500}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={updateOrder.isPending}>
                {updateOrder.isPending ? "Saving…" : "Save details"}
              </Button>
            </form>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <StatusNote note={note} onClear={clearNote} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
