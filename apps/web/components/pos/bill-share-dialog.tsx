"use client";

import { Copy, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCreateBillShare, type BillShareAdjustments } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api";

/**
 * A QR/link the guest scans to see this one bill on their own phone. A fresh
 * short-lived token is minted each time the dialog opens, carrying the
 * discount / tip / loyalty currently on the cashier's screen.
 */
export function BillShareDialog({
  orderId,
  branchId,
  adjustments,
  open,
  onOpenChange,
}: {
  orderId: string;
  branchId: string | null;
  adjustments: BillShareAdjustments;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createShare = useCreateBillShare(branchId);

  useEffect(() => {
    if (!open || !orderId) return;
    createShare.mutate(
      { orderId, adjustments },
      {
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not create a bill link"),
      },
    );
    // Mint once per open, not on every render or adjustment keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  const billUrl =
    createShare.data && typeof window !== "undefined"
      ? `${window.location.origin}/bill/${createShare.data.token}`
      : null;

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
      // Dismissing the native share sheet also rejects; not worth a toast.
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
                The guest scans this with a phone camera to see the bill — no app needed. The link
                works for two hours.
              </p>
              <div className="flex w-full gap-2">
                <input
                  readOnly
                  value={billUrl}
                  aria-label="Bill link"
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
            <Button variant="outline" onClick={() => createShare.mutate({ orderId, adjustments })}>
              Try again
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
