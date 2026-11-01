"use client";

import { Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/card";

const noop = () => () => undefined;
const origin = () => window.location.origin;

/**
 * Settings > Mobile app. The QR holds this server's address: staff and riders
 * open the OrderRestro app, tap Scan QR code, then sign in as usual.
 */
export function MobileAppCard() {
  const url = useSyncExternalStore(noop, origin, () => "");
  const local = /localhost|127\.0\.0\.1/.test(url);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Smartphone className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
        <h2 className="text-[18px] font-medium text-foreground">Mobile app</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Staff and delivery riders can use OrderRestro on Android and iPhone. Install the app, tap Scan QR code and
        sign in with the same login as here. Riders sign in with their phone number.
      </p>
      {url && (
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="rounded-xl border bg-white p-3">
            <QRCodeSVG value={url} size={148} level="M" marginSize={0} />
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Server address</p>
            <p className="break-all font-mono text-foreground">{url}</p>
            {local && (
              <p className="mt-2 text-warning">
                This address only works on this computer. Open Settings from the computer&apos;s network address
                (for example http://192.168.1.20:1995) so phones can reach it.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
