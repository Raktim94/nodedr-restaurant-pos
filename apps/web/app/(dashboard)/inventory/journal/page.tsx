"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { ManufacturingReportsView } from "@/components/inventory/manufacturing-reports-view";
import { MovementsView } from "@/components/inventory/movements-view";
import { ProductionView } from "@/components/inventory/production-view";
import { StockJournalVoucher } from "@/components/inventory/stock-journal-voucher";
import { useBranch } from "@/hooks/use-branch";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "voucher", label: "New voucher", hint: "Record materials used and products made" },
  { id: "entries", label: "Entries", hint: "Production entries, correct or reverse" },
  { id: "report", label: "Production report", hint: "Days, batches, cost and yield" },
  { id: "movements", label: "Stock movements", hint: "Every stock change, receive and adjust" },
] as const;
type View = (typeof VIEWS)[number]["id"];

function JournalShell() {
  const { branchId } = useBranch();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("view");
  const view: View = VIEWS.some((v) => v.id === raw) ? (raw as View) : "voucher";
  const [voucherKey, setVoucherKey] = useState(0);
  const go = (id: View) => router.replace(id === "voucher" ? "/inventory/journal" : `/inventory/journal?view=${id}`);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
      </div>
      <InventoryTabs />
      <div role="tablist" aria-label="Stock journal views" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={view === v.id}
            title={v.hint}
            onClick={() => go(v.id)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", view === v.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "voucher" && (
        <StockJournalVoucher key={voucherKey} inline branchId={branchId} open onOpenChange={(o) => { if (!o) setVoucherKey((n) => n + 1); }} />
      )}
      {view === "entries" && <ProductionView embedded />}
      {view === "report" && <ManufacturingReportsView embedded />}
      {view === "movements" && <MovementsView />}
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={null}>
      <JournalShell />
    </Suspense>
  );
}
