"use client";

import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useOpenCashDrawer, usePrintTestSlip, usePrinterDiagnostics } from "@/hooks/use-print";
import { useSettings, useUpdateBranchSettings } from "@/hooks/use-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

export function PrinterDiagnosticsCard() {
  const { branchId } = useBranch();
  const { data, isLoading, isFetching, refetch } = usePrinterDiagnostics(branchId);
  const { data: settings } = useSettings(branchId);
  const updateBranch = useUpdateBranchSettings(branchId);
  const testPrint = usePrintTestSlip(branchId);
  const testKot = usePrintTestSlip(branchId, "kot");
  const { note, clear: clearNote, toast } = useNoteToast();
  const [host, setHost] = useState<string | null>(null);
  const [port, setPort] = useState<string | null>(null);
  const branch = settings?.branch;
  const [columns, setColumns] = useState<string | null>(null);
  const save = (dto: Parameters<typeof updateBranch.mutate>[0]) =>
    updateBranch.mutate(dto, {
      onSuccess: () => toast.success("Printer settings saved"),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save printer settings"),
    });
  const openDrawer = useOpenCashDrawer();

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Thermal printer (receipts &amp; kitchen tickets)</h2>
          <p className="text-sm text-muted-foreground">
            Native ESC/POS printing, independent of the browser print dialog. The printer must be reachable
            from the machine running OrderRestro: USB on a Linux host, or a network printer on port 9100.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      <StatusNote note={note} onClear={clearNote} />

      {isLoading || !data ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            {data.canPrint ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-foreground">
                  {data.connection === "NETWORK" && data.network
                    ? `Printer reachable at ${data.network.host}:${data.network.port}`
                    : "Printer detected"}
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-foreground">
                  {data.connection === "NETWORK" ? "Printer not reachable" : "No printer detected"}
                </span>
              </>
            )}
          </div>
          {data.lpDevices.length > 0 && (
            <p className="text-xs text-muted-foreground">Kernel device(s): {data.lpDevices.join(", ")}</p>
          )}
          {data.libusbPrinter && (
            <p className="text-xs text-muted-foreground">USB device: {data.libusbPrinter.id}</p>
          )}
          {data.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      )}

      {branch && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Label>Connection</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Printer connection">
              {(["USB", "NETWORK"] as const).map((c) => (
                <Button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={branch.printerConnection === c}
                  variant={branch.printerConnection === c ? "default" : "outline"}
                  size="sm"
                  disabled={updateBranch.isPending}
                  onClick={() => save({ printerConnection: c })}
                >
                  {c === "USB" ? "USB (on this server)" : "Network (IP address)"}
                </Button>
              ))}
            </div>
            {branch.printerConnection === "USB" && !branch.printerHost && (
              <p className="text-xs text-muted-foreground">
                For a network printer, enter its address below and save it, then choose Network.
              </p>
            )}
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-host">Printer address</Label>
              <Input
                id="printer-host"
                inputMode="url"
                autoComplete="off"
                placeholder="192.168.1.50"
                value={host ?? branch.printerHost ?? ""}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-port">Port</Label>
              <Input
                id="printer-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                value={port ?? String(branch.printerPort)}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>
          {(host !== null || port !== null) && (
            <Button
              type="button"
              size="sm"
              disabled={updateBranch.isPending}
              onClick={() => {
                const dto: Parameters<typeof updateBranch.mutate>[0] = {};
                if (host !== null) dto.printerHost = host.trim() || null;
                if (port !== null) dto.printerPort = Number(port);
                updateBranch.mutate(dto, {
                  onSuccess: () => {
                    toast.success("Printer address saved");
                    setHost(null);
                    setPort(null);
                    refetch();
                  },
                  onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not save the address"),
                });
              }}
            >
              Save address
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Paper width</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Paper width">
              {([58, 80] as const).map((mm) => (
                <Button
                  key={mm}
                  type="button"
                  role="radio"
                  aria-checked={branch.printerPaperWidthMm === mm}
                  variant={branch.printerPaperWidthMm === mm ? "default" : "outline"}
                  size="sm"
                  disabled={updateBranch.isPending}
                  onClick={() => save({ printerPaperWidthMm: mm, printerColumns: null })}
                >
                  {mm} mm
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-codepage">Character set</Label>
              <select
                id="printer-codepage"
                className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
                value={branch.printerCodepage}
                disabled={updateBranch.isPending}
                onChange={(e) => save({ printerCodepage: e.target.value as typeof branch.printerCodepage })}
              >
                <option value="CP858">CP858 — Spanish/Western + € (recommended)</option>
                <option value="CP850">CP850 — Western Europe</option>
                <option value="CP437">CP437 — US / legacy</option>
                <option value="CP1252">WPC1252 — Windows Latin</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-columns">Columns (blank = {branch.printerPaperWidthMm === 58 ? 32 : 48})</Label>
              <Input
                id="printer-columns"
                type="number"
                min={20}
                max={64}
                inputMode="numeric"
                value={columns ?? (branch.printerColumns ?? "")}
                onChange={(e) => setColumns(e.target.value)}
                onBlur={() => {
                  if (columns === null) return;
                  const n = columns === "" ? null : Number(columns);
                  if (n !== null && (!Number.isInteger(n) || n < 20 || n > 64)) {
                    toast.error("Columns must be between 20 and 64");
                  } else if (n !== branch.printerColumns) {
                    save({ printerColumns: n });
                  }
                  setColumns(null);
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Text is sent as native printer text, not an image. Run &ldquo;Send test print&rdquo; after changing these:
            the ruler line should fill one line exactly and the accents line should read correctly.
          </p>
        </div>
      )}

      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={testPrint.isPending}
          onClick={() =>
            testPrint.mutate(undefined, {
              onSuccess: () => toast.success("Test slip sent"),
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : "Could not print a test slip"),
            })
          }
        >
          {testPrint.isPending ? "Printing…" : "Send test print"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-2"
          disabled={testKot.isPending}
          onClick={() =>
            testKot.mutate(undefined, {
              onSuccess: () => toast.success("Sample kitchen ticket sent"),
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : "Could not print the sample kitchen ticket"),
            })
          }
        >
          {testKot.isPending ? "Printing…" : "Test kitchen ticket"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-2"
          disabled={openDrawer.isPending}
          onClick={() =>
            openDrawer.mutate(branchId, {
              onSuccess: () => toast.success("Cash drawer pulse sent"),
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : "Could not open the cash drawer"),
            })
          }
        >
          Open cash drawer
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          The drawer must be plugged into the printer&rsquo;s drawer (RJ11) port. Receipts printed via USB for cash
          payments open it automatically.
        </p>
      </div>
    </Card>
  );
}
