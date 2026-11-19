"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  ArrowLeftRight, 
  ArrowRight, 
  Building2, 
  Clock, 
  History, 
  Package, 
  Plus, 
  SendHorizontal, 
  Sparkles, 
  Truck 
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients } from "@/hooks/use-inventory";
import { api, ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TransferView {
  branches: { id: string; name: string }[];
  history: {
    id: string;
    createdAt: string;
    fromBranchId: string;
    fromBranchName: string;
    toBranchName: string;
    ingredientName: string;
    unit: string;
    quantity: string;
    unitCost: string;
    note: string | null;
  }[];
}

export default function TransfersPage() {
  const { branchId } = useBranch();
  const qc = useQueryClient();
  const { data: ingredients } = useIngredients(branchId);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["transfers", branchId],
    queryFn: () => api.get<TransferView>(`/inventory/transfers?branchId=${branchId}`),
    enabled: !!branchId,
  });

  const [toBranchId, setTo] = useState("");
  const [ingredientId, setIngredient] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const ingredient = ingredients?.find((i) => i.id === ingredientId);

  const send = useMutation({
    mutationFn: () =>
      api.post(`/inventory/transfers?branchId=${branchId}`, {
        toBranchId,
        ingredientId,
        quantity: Number(quantity),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transfers"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      setQuantity("");
      setNote("");
      setIngredient("");
      toast.success("Stock transfer dispatched successfully");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Transfer failed"),
  });

  const noOtherBranch = !!data && data.branches.length === 0;

  return (
    <div className="flex flex-col gap-5 sm:gap-6 pb-20">
      {/* Page Title */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Inter-Branch Stock Transfers
            </h1>
            <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground border-border/70">
              Multi-Location
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Relocate stock and transfer cost value seamlessly between restaurant outlets
          </p>
        </div>
      </div>

      <InventoryTabs />

      {/* Transfer Creator Card */}
      <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs flex flex-col gap-4">
        <div className="flex items-center gap-2 pb-1 border-b border-border/50">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Truck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Initiate Stock Transfer</h2>
            <p className="text-xs text-muted-foreground">
              Transfer items from this active branch to another location
            </p>
          </div>
        </div>

        {noOtherBranch ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs sm:text-sm text-muted-foreground">
            <Building2 className="h-8 w-8 text-muted-foreground/60 mx-auto mb-2" />
            <p className="font-semibold text-foreground">Only One Branch Configured</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Configure a second branch in Settings → Branch Management to enable inter-branch stock logistics.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ingredientId && toBranchId && Number(quantity) > 0) send.mutate();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
          >
            {/* Ingredient Selector */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tr-ing" className="text-xs font-medium text-foreground">
                Item to Send
              </label>
              <select
                id="tr-ing"
                className={cn(selectClass, "h-9.5 text-xs rounded-xl bg-background")}
                value={ingredientId}
                onChange={(e) => setIngredient(e.target.value)}
              >
                <option value="">Select ingredient…</option>
                {ingredients?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.currentStock} {i.unit})
                  </option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tr-qty" className="text-xs font-medium text-foreground">
                Quantity {ingredient ? `(${ingredient.unit})` : ""}
              </label>
              <Input
                id="tr-qty"
                type="number"
                min="0"
                step="0.001"
                placeholder="e.g. 10.0"
                className="h-9.5 text-xs rounded-xl bg-background tabular-nums font-semibold"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            {/* Destination Branch */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tr-to" className="text-xs font-medium text-foreground">
                Destination Branch
              </label>
              <select
                id="tr-to"
                className={cn(selectClass, "h-9.5 text-xs rounded-xl bg-background")}
                value={toBranchId}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Select receiving outlet…</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Transfer Note & Submit */}
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1.5 flex-1">
                <label htmlFor="tr-note" className="text-xs font-medium text-foreground">
                  Reason / Note
                </label>
                <Input
                  id="tr-note"
                  placeholder="e.g. Evening shift replenishment"
                  className="h-9.5 text-xs rounded-xl bg-background"
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                disabled={!ingredientId || !toBranchId || !(Number(quantity) > 0) || send.isPending}
                className="h-9.5 rounded-xl px-4 text-xs font-semibold shadow-xs shrink-0 gap-1.5"
              >
                <SendHorizontal className="h-3.5 w-3.5" />
                <span>{send.isPending ? "Sending…" : "Dispatch"}</span>
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Transfer History Log */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 px-1">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Transfer Audit Log
          </h2>
        </div>

        {isLoading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : data && data.history.length > 0 ? (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block rounded-2xl border border-border/80 bg-card overflow-hidden shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border/80">
                    <TableHead className="font-semibold text-xs text-foreground py-3">Timestamp</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Ingredient</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Quantity</TableHead>
                    <TableHead className="font-semibold text-xs text-foreground py-3">Transfer Route</TableHead>
                    <TableHead className="text-right font-semibold text-xs text-foreground py-3">Unit Valuation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.history.map((t) => (
                    <TableRow key={t.id} className="transition-colors hover:bg-muted/30">
                      <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(t.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm text-foreground">{t.ingredientName}</span>
                          {t.note && (
                            <span className="text-xs text-muted-foreground italic">
                              &ldquo;{t.note}&rdquo;
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 tabular-nums font-bold text-sm text-foreground">
                        {t.quantity} <span className="text-xs font-normal text-muted-foreground">{t.unit}</span>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-medium text-foreground rounded-md bg-secondary px-2 py-0.5">
                            {t.fromBranchName}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium text-primary rounded-md bg-primary/10 px-2 py-0.5">
                            {t.toBranchName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-right tabular-nums text-xs font-semibold text-foreground">
                        {formatCurrency(Number(t.unitCost))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden flex flex-col gap-2.5">
              {data.history.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-card p-3.5 shadow-2xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-foreground">{t.ingredientName}</span>
                    <span className="font-bold tabular-nums text-sm text-foreground">
                      {t.quantity} <span className="text-xs font-normal text-muted-foreground">{t.unit}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-foreground font-medium">
                      {t.fromBranchName}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded-md bg-primary/10 text-primary font-medium px-1.5 py-0.5">
                      {t.toBranchName}
                    </span>
                  </div>

                  {t.note && (
                    <p className="text-xs italic text-muted-foreground">
                      &ldquo;{t.note}&rdquo;
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                    <span>{new Date(t.createdAt).toLocaleString()}</span>
                    <span className="font-semibold text-foreground">
                      {formatCurrency(Number(t.unitCost))} / {t.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-2 py-16 text-center rounded-2xl border-dashed bg-card/60">
            <ArrowLeftRight className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">No Stock Transfers Recorded</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Use the transfer dispatch form above to move ingredients from this location to any other outlet.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
