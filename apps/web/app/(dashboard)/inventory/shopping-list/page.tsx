"use client";

import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { csvUrl, useExpiring, useReorder } from "@/hooks/use-stock-journal";

export default function ShoppingListPage() {
  const { branchId } = useBranch();
  const { data: list, isLoading, isError } = useReorder(branchId);
  const { data: expiring } = useExpiring(branchId, 7);
  const byCat = new Map<string, NonNullable<typeof list>>();
  for (const r of list ?? []) byCat.set(r.category || "Other", [...(byCat.get(r.category || "Other") ?? []), r]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" href={csvUrl("journal/reorder.csv", branchId)}>Download CSV</a>
          <button type="button" className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="print:hidden"><InventoryTabs /></div>

      <section aria-label="Expiring soon" id="expiring" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Use these first (expiring in 7 days)</h2>
        {expiring && expiring.length > 0 ? (
          <Card className="p-0">
            <ul className="divide-y divide-border text-sm">
              {expiring.map((e) => (
                <li key={e.batchId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span className="font-medium">{e.name}{e.storageLocation ? <span className="font-normal text-muted-foreground"> · {e.storageLocation}</span> : null}</span>
                  <span className="flex items-center gap-2 tabular-nums">{e.quantity} {e.unit}
                    <Badge variant={e.expired || e.daysLeft <= 1 ? "destructive" : "outline"}>{e.expired ? "Expired" : e.daysLeft <= 0 ? "Today" : `${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}`}</Badge></span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing expires in the next 7 days. Add an expiry date when receiving stock to see it here.</p>
        )}
      </section>

      <section aria-label="To buy" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">To buy</h2>
        {isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : isError ? (
          <Card className="p-6 text-sm text-destructive">Could not load the list.</Card>
        ) : list && list.length > 0 ? (
          [...byCat.entries()].map(([cat, rows]) => (
            <Card key={cat} className="p-0">
              <h3 className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h3>
              <ul className="divide-y divide-border text-sm">
                {rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-2.5">
                    <span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted-foreground">{r.inStock} {r.unit} left, minimum {r.minimum}, order up to {r.par}{r.storageLocation ? ` · ${r.storageLocation}` : ""}</span></span>
                    <span className="text-right text-base font-semibold tabular-nums">{r.toBuy} {r.unit}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))
        ) : (
          <Card className="py-12 text-center text-sm text-muted-foreground">Nothing is at or below its minimum. Set a minimum on each item to get a shopping list.</Card>
        )}
      </section>
    </div>
  );
}
