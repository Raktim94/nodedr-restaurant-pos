"use client";

import { Factory } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ManufacturingBatchDialog } from "@/components/inventory/manufacturing-batch-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMfgSettings } from "@/hooks/use-manufacturing";

// Shown under the food menu only when the restaurant has switched manufacturing on AND this user may record
// production (the settings call is refused otherwise, and the card stays hidden). Numbers appear only when real
// batches exist; nothing here is a placeholder.
export function ManufacturingCard({ branchId }: { branchId: string | null }) {
  const { data: s } = useMfgSettings(branchId);
  const [open, setOpen] = useState(false);
  if (!s || !s.enabled) return null;
  return (
    <>
      <Card aria-label="Food Manufacturing Costs" className="flex shrink-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Factory className="size-5" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Food Manufacturing Costs</h2>
            <p className="text-xs text-muted-foreground">Record what a batch used and made, and see what each unit cost.</p>
            {s.latest && (
              <p className="mt-1 text-xs text-foreground">
                Last batch: {s.latest.item} at <b className="tabular-nums">{Number(s.latest.unitCost).toFixed(2)}</b> per {s.latest.unit?.toLowerCase()} on {new Date(s.latest.producedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button className="h-12 w-full sm:h-9 sm:w-auto" onClick={() => setOpen(true)}>New production batch</Button>
          {s.canReport && (
            <Link href="/inventory/manufacturing-reports" className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border px-3 text-sm hover:bg-muted sm:h-9 sm:w-auto">Stock Journal Reports</Link>
          )}
        </div>
      </Card>
      {open && <ManufacturingBatchDialog branchId={branchId} open onOpenChange={setOpen} />}
    </>
  );
}
