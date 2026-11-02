"use client";

import { Bluetooth, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  nativePrinter,
  registerPrinterPicker,
  saveBtPrinter,
  type BtPrinter,
} from "@/lib/device-print";

/**
 * "Choose a Bluetooth printer": lists the printers already paired with this
 * phone. Mounted once; the printing code opens it through chooseBtPrinter()
 * the first time someone prints, and Settings > Printer opens it to change.
 */
export function BtPrinterDialog() {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<BtPrinter[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((p: BtPrinter | null) => void) | null>(null);

  const load = useCallback(async () => {
    const np = nativePrinter();
    if (!np) return;
    setBusy(true);
    setInfo(null);
    try {
      const r = await np.btPrinters();
      setDevices(r.devices);
      if (!r.supported) setInfo("This phone has no Bluetooth.");
      else if (!r.enabled) setInfo("Bluetooth is off. Turn it on, then tap Refresh.");
      else if (r.devices.length === 0)
        setInfo("No paired printers yet. Pair the printer in the phone's Bluetooth settings, then tap Refresh.");
    } catch (e) {
      setInfo(e instanceof Error ? e.message : typeof e === "string" ? e : "Could not read the paired devices.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(
    () =>
      registerPrinterPicker((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setOpen(true);
        void load();
      }),
    [load],
  );

  const finish = (p: BtPrinter | null) => {
    if (p) saveBtPrinter(p);
    resolver.current?.(p);
    resolver.current = null;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="h-5 w-5" aria-hidden /> Choose a Bluetooth printer
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Switch the printer on and pair it once in the phone&apos;s Bluetooth settings. Pick it here and bills and
          kitchen tickets print straight from this phone.
        </p>
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {devices.map((d) => (
            <li key={d.address}>
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full justify-start gap-3 text-base"
                onClick={() => finish(d)}
              >
                <Printer className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-left">{d.name}</span>
                <span className="text-xs text-muted-foreground">{d.address}</span>
              </Button>
            </li>
          ))}
        </ul>
        {info && (
          <p role="status" className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
            {info}
          </p>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="h-4 w-4" aria-hidden /> {busy ? "Looking…" : "Refresh"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
