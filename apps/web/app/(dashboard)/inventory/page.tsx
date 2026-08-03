"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
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
import { useBranch } from "@/hooks/use-branch";
import { useIngredients } from "@/hooks/use-inventory";
import { formatCurrency } from "@/lib/format";

export default function InventoryPage() {
  const { branchId } = useBranch();
  const [search, setSearch] = useState("");
  const { data: ingredients, isLoading } = useIngredients(branchId);

  const filtered = ingredients?.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
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
        <AddIngredientDialog branchId={branchId} />
      </div>

      <InventoryTabs />

      <Input
        placeholder="Search ingredients…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

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
