"use client";

import { useI18n } from "@/lib/i18n/context";
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
  const { t } = useI18n();
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
      onSuccess: () => toast.success(t("Printer settings saved")),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not save printer settings")),
    });
  const openDrawer = useOpenCashDrawer();

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("Thermal printer (receipts & kitchen tickets)")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Native ESC/POS printing, independent of the browser print dialog. The printer must be reachable from the machine running OrderRestro: USB on a Linux host, or a network printer on port 9100.")}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("Refresh printer status")} onClick={() => refetch()} disabled={isFetching}>
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
                    ? t("Printer reachable at {host}:{port}", { host: data.network.host, port: data.network.port })
                    : t("Printer detected")}
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-foreground">
                  {data.connection === "NETWORK" ? t("Printer not reachable") : t("No printer detected")}
                </span>
              </>
            )}
          </div>
          {data.lpDevices.length > 0 && (
            <p className="text-xs text-muted-foreground">{t("Kernel device(s): {join}", { join: data.lpDevices.join(", ") })}</p>
          )}
          {data.libusbPrinter && (
            <p className="text-xs text-muted-foreground">{t("USB device: {id}", { id: data.libusbPrinter.id })}</p>
          )}
          {data.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {data.network && !data.network.reachable && note.startsWith("Cannot reach ")
                ? t("Cannot reach {host}:{port} from the server{detail}.", {
                    host: data.network.host,
                    port: data.network.port,
                    detail: data.network.error ? ` (${data.network.error})` : "",
                  })
                : t(note)}
            </p>
          ))}
        </div>
      )}

      {branch && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("Connection")}</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Printer connection")}>
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
                  {c === "USB" ? t("USB (on this server)") : t("Network (IP address)")}
                </Button>
              ))}
            </div>
            {branch.printerConnection === "USB" && !branch.printerHost && (
              <p className="text-xs text-muted-foreground">
                {t("For a network printer, enter its address below and save it, then choose Network.")}
              </p>
            )}
          </div>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-host">{t("Printer address")}</Label>
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
              <Label htmlFor="printer-port">{t("Port")}</Label>
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
                    toast.success(t("Printer address saved"));
                    setHost(null);
                    setPort(null);
                    refetch();
                  },
                  onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Could not save the address")),
                });
              }}
            >
              {t("Save address")}
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{t("Paper width")}</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Paper width")}>
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
                >{t("{mm} mm", { mm })}</Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-codepage">{t("Character set")}</Label>
              <select
                id="printer-codepage"
                className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
                value={branch.printerCodepage}
                disabled={updateBranch.isPending}
                onChange={(e) => save({ printerCodepage: e.target.value as typeof branch.printerCodepage })}
              >
                <option value="CP858">{t("CP858 — Spanish/Western + € (recommended)")}</option>
                <option value="CP850">{t("CP850 — Western Europe")}</option>
                <option value="CP437">{t("CP437 — US / legacy")}</option>
                <option value="CP1252">{t("WPC1252 — Windows Latin")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="printer-columns">{t("Columns (blank =")} {branch.printerPaperWidthMm === 58 ? 32 : 48})</Label>
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
                    toast.error(t("Columns must be between 20 and 64"));
                  } else if (n !== branch.printerColumns) {
                    save({ printerColumns: n });
                  }
                  setColumns(null);
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Text is sent as native printer text, not an image. Run “Send test print” after changing these: the ruler line should fill one line exactly and the accents line should read correctly.")}
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
              onSuccess: () => toast.success(t("Test slip sent")),
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : t("Could not print a test slip")),
            })
          }
        >
          {testPrint.isPending ? t("Printing…") : t("Send test print")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-2"
          disabled={testKot.isPending}
          onClick={() =>
            testKot.mutate(undefined, {
              onSuccess: () => toast.success(t("Sample kitchen ticket sent")),
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : t("Could not print the sample kitchen ticket")),
            })
          }
        >
          {testKot.isPending ? t("Printing…") : t("Test kitchen ticket")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-2"
          disabled={openDrawer.isPending}
          onClick={() =>
            openDrawer.mutate(branchId, {
              onSuccess: () => toast.success(t("Cash drawer pulse sent")),
              onError: (err) =>
                toast.error(err instanceof ApiError ? err.message : t("Could not open the cash drawer")),
            })
          }
        >
          {t("Open cash drawer")}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("The drawer must be plugged into the printer’s drawer (RJ11) port. Receipts printed via USB for cash payments open it automatically.")}
        </p>
      </div>
    </Card>
  );
}
