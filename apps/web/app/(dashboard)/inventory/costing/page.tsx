"use client";

import { AlertTriangle } from "lucide-react";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useCostingOverview } from "@/hooks/use-costing";
import { formatCurrency } from "@/lib/format";

const money = (v: number | null) => (v === null ? "—" : formatCurrency(v));

export default function CostingPage() {
  const { branchId } = useBranch();
  const { data, isLoading, error } = useCostingOverview(branchId);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Recipe costing</h1>
        <p className="text-sm text-muted-foreground">What each dish costs, what it earns before tax, and where margins are slipping. Open a dish under Menu → Edit to change its recipe.</p>
      </div>
      <InventoryTabs />
      {error && <p role="alert" className="text-sm text-destructive">You need inventory access to see costs.</p>}
      {isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {data && (
        <>
          {data.alerts.length > 0 && (
            <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="font-medium text-foreground">{data.alerts.length} dish{data.alerts.length === 1 ? "" : "es"} with a shrinking margin</p>
                <ul className="mt-1 text-muted-foreground">
                  {data.alerts.map((a) => <li key={a.menuItemId}>{a.name}: {a.alertMessage}</li>)}
                </ul>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {data.withoutRecipe} dishes have no recipe · {data.unpriced} have an unpriced ingredient · margins are measured on revenue before tax ({data.taxMode === "INCLUSIVE" ? "menu prices include tax" : "tax is added on top of menu prices"}).
          </p>
          <div className="grid gap-2 md:hidden">
            {data.items.map((r) => (
              <Card key={r.menuItemId} className="flex items-center justify-between gap-3 p-3">
                <div><p className="font-medium text-foreground">{r.name}</p><p className="text-xs text-muted-foreground">{r.category} · price {money(r.price)}</p></div>
                <div className="text-right text-sm"><p>{money(r.costPerPortion)}</p><p className="text-xs text-muted-foreground">{r.grossMarginPercent === null ? "no cost yet" : `${r.grossMarginPercent}% margin`}</p></div>
              </Card>
            ))}
          </div>
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-3">Dish</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">Profit</th><th className="p-3 text-right">Food cost</th><th className="p-3 text-right">Margin</th><th className="p-3" /></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.menuItemId} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium text-foreground">{r.name}</td>
                    <td className="p-3 text-right tabular-nums">{money(r.price)}</td>
                    <td className="p-3 text-right tabular-nums">{money(r.costPerPortion)}</td>
                    <td className="p-3 text-right tabular-nums">{money(r.grossProfit)}</td>
                    <td className="p-3 text-right tabular-nums">{r.foodCostPercent === null ? "—" : `${r.foodCostPercent}%`}</td>
                    <td className="p-3 text-right tabular-nums">{r.grossMarginPercent === null ? "—" : `${r.grossMarginPercent}%`}</td>
                    <td className="p-3">{r.source === "NONE" ? <Badge variant="outline">No recipe</Badge> : !r.complete ? <Badge variant="outline">Unpriced</Badge> : r.alert === "LOSS" ? <Badge variant="destructive">Below cost</Badge> : r.alert === "WATCH" ? <Badge variant="destructive">Watch</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
