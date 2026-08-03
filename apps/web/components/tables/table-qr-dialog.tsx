"use client";

import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRotateQrToken, type RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function TableQrDialog({
  table,
  branchId,
  open,
  onOpenChange,
}: {
  table: RestaurantTable;
  branchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rotate = useRotateQrToken(branchId);

  const orderUrl =
    table.qrToken && typeof window !== "undefined"
      ? `${window.location.origin}/order/${table.qrToken}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{table.name ?? `Table ${table.number}`} — QR code</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {orderUrl ? (
            <>
              <div className="rounded-2xl border border-border bg-white p-4">
                <QRCodeSVG value={orderUrl} size={200} />
              </div>
              <p className="max-w-xs text-center text-xs text-muted-foreground break-all">
                {orderUrl}
              </p>
            </>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              No QR code yet — generate one below.
            </p>
          )}

          <div className="flex gap-2">
            {orderUrl && (
              <Button variant="outline" onClick={() => window.print()}>
                Print
              </Button>
            )}
            <Button
              variant={orderUrl ? "outline" : "default"}
              disabled={rotate.isPending}
              onClick={() =>
                rotate.mutate(table.id, {
                  onError: (err) =>
                    toast.error(err instanceof ApiError ? err.message : "Could not generate QR code"),
                })
              }
            >
              {orderUrl ? "Generate new code" : "Generate QR code"}
            </Button>
          </div>
          {orderUrl && (
            <p className="text-center text-xs text-muted-foreground">
              Generating a new code invalidates this one — reprint any table tents using it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
