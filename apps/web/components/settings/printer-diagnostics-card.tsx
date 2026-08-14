"use client";

import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePrintTestSlip, usePrinterDiagnostics } from "@/hooks/use-print";
import { ApiError } from "@/lib/api";

export function PrinterDiagnosticsCard() {
  const { data, isLoading, isFetching, refetch } = usePrinterDiagnostics();
  const testPrint = usePrintTestSlip();

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">USB thermal printer</h2>
          <p className="text-sm text-muted-foreground">
            Direct-USB ESC/POS printing, independent of the browser print dialog. Linux hosts only.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            {data.canPrint ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-foreground">Printer detected</span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-foreground">No printer detected</span>
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
      </div>
    </Card>
  );
}
