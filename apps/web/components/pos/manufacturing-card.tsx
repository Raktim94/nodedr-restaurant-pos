"use client";

import { Factory } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StockJournalVoucher } from "@/components/inventory/stock-journal-voucher";
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
      <Button
        variant="outline"
        size="sm"
        aria-label="Manufacturing"
        onClick={() => setOpen(true)}
        className="h-8 rounded-xl border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <Factory className="h-3.5 w-3.5 text-primary mr-1" />
        <span className="hidden sm:inline">Manufacturing</span>
      </Button>
      {open && <StockJournalVoucher branchId={branchId} open onOpenChange={setOpen} />}
    </>
  );
}
