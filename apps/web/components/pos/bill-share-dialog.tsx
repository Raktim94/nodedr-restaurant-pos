"use client";

import { Copy, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateBillShare } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api";

/**
 * A QR/link the guest scans with their own phone to see this one bill — no
 * printer or paper needed. A fresh, short-lived token (see bill-share
 * backend module) is minted each time this opens, so closing and reopening
 * always hands out a live one rather than reusing a stale copy.
 */
export function BillShareDialog({
  orderId,
  branchId,
  open,
  onOpenChange,
}: {
  orderId: string;
  branchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createShare = useCreateBillShare(branchId);

  useEffect(() => {
    if (!open) return;
    createShare.mutate(orderId, {
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not create a bill link"),
    });
    // Only when the dialog opens for this order — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const billUrl =
    createShare.data && typeof window !== "undefined"
      ? `${window.location.origin}/bill/${createShare.data.token}`
      : null;

  // Drop the previous link (if any) as soon as the dialog closes, so
  // reopening it never briefly shows a stale QR before the new one loads.
  const handleOpenChange = (next: boolean) => {
    if (!next) createShare.reset();
    onOpenChange(next);
  };

  const copyLink = () =>
    billUrl &&
    navigator.clipboard
      .writeText(billUrl)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Copy failed — select the link and copy it"));

  const shareLink = () =>
    billUrl &&
    navigator.share?.({ title: "Your bill", url: billUrl }).catch(() => {
      // Cancelling the native share sheet also rejects — not an error worth a toast.
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Share this bill</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {createShare.isPending && (
            <p className="py-8 text-sm text-muted-foreground">Creating a bill link…</p>
          )}

          {billUrl && (
            <>
              <div className="rounded-2xl border border-border bg-white p-4">
                <QRCodeSVG value={billUrl} size={200} />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                The guest scans this with a phone camera to see the bill — no app needed. Valid
                for a couple of hours.
              </p>
              <div className="flex w-full gap-2">
                <input
                  readOnly
                  value={billUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground"
                />
                <Button variant="outline" size="icon" aria-label="Copy bill link" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
                {typeof navigator !== "undefined" && !!navigator.share && (
                  <Button variant="outline" size="icon" aria-label="Share bill link" onClick={shareLink}>
                    <Share2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </>
          )}

          {createShare.isError && !createShare.isPending && (
            <Button variant="outline" onClick={() => createShare.mutate(orderId)}>
              Try again
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
