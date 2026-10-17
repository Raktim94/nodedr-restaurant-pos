"use client";

import { Copy, ExternalLink, KeyRound } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useSetKiosk,
  useUpdateBranchSettings,
  type BranchSettings,
} from "@/hooks/use-settings";

// Settings > Customer kiosk. The URL's token is the only credential the public
// kiosk screen has: it can read the menu and place orders, nothing else.
export function KioskCard({
  branchId,
  branch,
}: {
  branchId: string | null;
  branch: BranchSettings;
}) {
  const setKiosk = useSetKiosk(branchId);
  const update = useUpdateBranchSettings(branchId);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const url =
    branch.kioskToken && typeof window !== "undefined"
      ? `${window.location.origin}/kiosk/${branch.kioskToken}`
      : null;

  const run = (action: "enable" | "rotate" | "disable", done: string) =>
    setKiosk.mutate(action, {
      onSuccess: () => {
        toast.success(done);
        setConfirmRotate(false);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the kiosk"),
    });
  const save = (dto: { kioskDineInEnabled?: boolean; kioskTakeawayEnabled?: boolean }) =>
    update.mutate(dto, {
      onSuccess: () => toast.success("Saved"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
    });

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-medium text-foreground">Customer kiosk</h2>
        <p className="text-sm text-muted-foreground">
          A full-screen, self-service ordering page for a customer-facing touchscreen. It shows
          only the menu and an order basket — no staff screens, no customer records. Orders go
          straight to the kitchen display; payment is taken separately at the counter.
        </p>
      </div>

      {!branch.kioskToken ? (
        <div>
          <Button onClick={() => run("enable", "Kiosk enabled")} disabled={setKiosk.isPending}>
            Enable kiosk
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor="kiosk-url">Kiosk address (open this on the kiosk)</Label>
              <div className="flex gap-2">
                <input
                  id="kiosk-url"
                  readOnly
                  value={url ?? ""}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground"
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy kiosk address"
                  onClick={() =>
                    url &&
                    navigator.clipboard
                      .writeText(url)
                      .then(() => toast.success("Copied"))
                      .catch(() => toast.error("Copy failed — select the address and copy it"))
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Open kiosk in a new tab"
                  onClick={() => url && window.open(url, "_blank", "noopener")}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Anyone with this address can place orders, so only open it on the kiosk. Use the
                HTTPS address (not a plain-HTTP LAN one) so Android can install it and keep the
                screen awake.
              </p>
            </div>
            {url && (
              <div className="shrink-0 rounded-lg bg-white p-2" aria-label="QR code of the kiosk address">
                <QRCodeSVG value={url} size={112} marginSize={1} />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="kiosk-dine-in">Offer “Eat here”</Label>
              <p className="text-xs text-muted-foreground">
                If only one option is on, the kiosk skips the choice screen.
              </p>
            </div>
            <Switch
              id="kiosk-dine-in"
              checked={branch.kioskDineInEnabled}
              disabled={update.isPending || (branch.kioskDineInEnabled && !branch.kioskTakeawayEnabled)}
              onCheckedChange={(v) => save({ kioskDineInEnabled: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <Label htmlFor="kiosk-takeaway">Offer “Take away”</Label>
            <Switch
              id="kiosk-takeaway"
              checked={branch.kioskTakeawayEnabled}
              disabled={update.isPending || (branch.kioskTakeawayEnabled && !branch.kioskDineInEnabled)}
              onCheckedChange={(v) => save({ kioskTakeawayEnabled: v })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {confirmRotate ? (
              <>
                <span className="text-sm text-foreground">
                  The current kiosk address will stop working immediately. Continue?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={setKiosk.isPending}
                  onClick={() => run("rotate", "New kiosk address created")}
                >
                  Yes, replace it
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRotate(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setConfirmRotate(true)}>
                  <KeyRound className="h-4 w-4" /> Create new address
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={setKiosk.isPending}
                  onClick={() => run("disable", "Kiosk turned off")}
                >
                  Turn kiosk off
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
