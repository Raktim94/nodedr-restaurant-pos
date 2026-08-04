"use client";

import { Layers, Leaf, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AddCategoryDialog } from "@/components/menu/add-category-dialog";
import { AddItemDialog } from "@/components/menu/add-item-dialog";
import { ComboComponentsDialog } from "@/components/menu/combo-components-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { useCategories, useDeleteMenuItem, useMenuItems, type MenuItem } from "@/hooks/use-menu";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function MenuPage() {
  const { branchId } = useBranch();
  const { data: categories, isLoading: categoriesLoading } = useCategories(branchId);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const { data: items, isLoading: itemsLoading } = useMenuItems(branchId, selectedCategoryId);
  const { data: allItems } = useMenuItems(branchId);
  const deleteItem = useDeleteMenuItem(branchId);
  const [comboItem, setComboItem] = useState<MenuItem | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Menu</h1>
          <p className="text-sm text-muted-foreground">Categories, items, and pricing</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Categories
            </h2>
          </div>

          {categoriesLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setSelectedCategoryId(undefined)}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                  !selectedCategoryId
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                All items
              </button>
              {categories?.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                    selectedCategoryId === cat.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <span>{cat.name}</span>
                  <span className="text-xs text-muted-foreground">{cat._count.items}</span>
                </button>
              ))}
            </div>
          )}

          <AddCategoryDialog branchId={branchId} />
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-medium text-foreground">Items</h2>
            <AddItemDialog branchId={branchId} categories={categories ?? []} />
          </div>

          {itemsLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : items && items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Station</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-foreground">
                      <div className="flex items-center gap-3">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- uploaded asset served from the backend, not a Next-optimizable remote source
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <div className="h-9 w-9 shrink-0 rounded-md bg-secondary" />
                        )}
                        {item.isVeg && <Leaf className="h-3.5 w-3.5 shrink-0 text-success" />}
                        {item.name}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.category.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.station ? (
                        <Badge variant="secondary" className="font-normal">
                          {item.station.name}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(item.price)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {Number(item.taxRatePercent)}%
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-8 w-8 text-muted-foreground hover:text-primary",
                            item.isCombo && "text-primary",
                          )}
                          title="Combo components"
                          onClick={() => setComboItem(item)}
                        >
                          <Layers className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            deleteItem.mutate(item.id, {
                              onSuccess: () => toast.success(`${item.name} removed`),
                              onError: (err) =>
                                toast.error(err instanceof ApiError ? err.message : "Could not remove item"),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-foreground">No items yet</p>
              <p className="text-sm text-muted-foreground">
                Add a category, then add your first menu item.
              </p>
            </div>
          )}
        </Card>
      </div>

      <ComboComponentsDialog
        branchId={branchId}
        item={comboItem}
        allItems={allItems ?? []}
        open={!!comboItem}
        onOpenChange={(open) => !open && setComboItem(null)}
      />
    </div>
  );
}
