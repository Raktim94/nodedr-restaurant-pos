"use client";

import { AlertTriangle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ImportCsvDialog } from "@/components/imports/import-csv-dialog";
import { AddIngredientDialog } from "@/components/inventory/add-ingredient-dialog";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients, useTrackingStatus } from "@/hooks/use-inventory";
import { formatCurrency } from "@/lib/format";

function InventoryView() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canImport = hasPermission(me?.user, "inventory.manage");
  const [search, setSearch] = useState("");
  // Dashboard deep link: /inventory?filter=low starts on the low-stock view.
  const params = useSearchParams();
  const [lowOnly, setLowOnly] = useState(() => params.get("filter") === "low");
  const { data: ingredients, isLoading } = useIngredients(branchId);
  const { data: trackingStatus } = useTrackingStatus(branchId);

  const filtered = ingredients?.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (!lowOnly || Number(i.currentStock) <= Number(i.reorderLevel)),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Ingredients, recipe costing, purchase orders, and waste
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImport && <ImportCsvDialog kind="ingredients" branchId={branchId} />}
          <AddIngredientDialog branchId={branchId} />
        </div>
      </div>

      <InventoryTabs />

      {trackingStatus && trackingStatus.problems.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">
              {trackingStatus.problems.length} stock-tracked menu item{trackingStatus.problems.length === 1 ? "" : "s"} will deduct nothing when sold
            </p>
            <p className="text-muted-foreground">
              Add a recipe or pick the stock item (Menu → Edit item → Stock when sold):{" "}
              {trackingStatus.problems.map((p) => p.name).join(", ")}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search ingredients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <button
          type="button"
          aria-pressed={lowOnly}
          onClick={() => setLowOnly((v) => !v)}
          className={
            "rounded-full border px-3.5 py-1.5 text-sm transition-colors " +
            (lowOnly
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-secondary")
          }
        >
          Low stock only
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered && filtered.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Current stock</TableHead>
                <TableHead className="text-right">Reorder level</TableHead>
                <TableHead className="text-right">Avg. cost / unit</TableHead>
                <TableHead className="text-right">Stock value</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => {
                const isLow = Number(i.currentStock) <= Number(i.reorderLevel);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {i.name}
                        {isLow && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Low stock
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{i.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.currentStock}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {i.reorderLevel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(i.costPerUnit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(Number(i.currentStock) * Number(i.costPerUnit))}
                    </TableCell>
                    <TableCell>
                      <AdjustStockDialog branchId={branchId} ingredient={i} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No ingredients yet</p>
            <p className="text-sm text-muted-foreground">
              Add your raw materials to start recipe costing and stock tracking.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <InventoryView />
    </Suspense>
  );
}
