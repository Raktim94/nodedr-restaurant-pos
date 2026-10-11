"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useIngredients } from "@/hooks/use-inventory";
import { api, ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

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
  const { data, isLoading } = useQuery({
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
      toast.success("Stock transferred");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Transfer failed"),
  });

  const noOtherBranch = !!data && data.branches.length === 0;
  const selectCls = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground">Move stock between your branches</p>
      </div>
      <InventoryTabs />

      <Card className="flex flex-col gap-4 p-4">
        {noOtherBranch ? (
          <p className="text-sm text-muted-foreground">Add a second branch to transfer stock between locations.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="tr-ing" className="text-xs text-muted-foreground">Ingredient (this branch)</label>
              <select id="tr-ing" className={selectCls} value={ingredientId} onChange={(e) => setIngredient(e.target.value)}>
                <option value="">Choose…</option>
                {ingredients?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.currentStock} {i.unit})</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="tr-qty" className="text-xs text-muted-foreground">Quantity{ingredient ? ` (${ingredient.unit})` : ""}</label>
              <Input id="tr-qty" type="number" min="0" step="0.001" className="w-32" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="tr-to" className="text-xs text-muted-foreground">To branch</label>
              <select id="tr-to" className={selectCls} value={toBranchId} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose…</option>
                {data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="tr-note" className="text-xs text-muted-foreground">Note</label>
              <Input id="tr-note" className="w-52" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button disabled={!ingredientId || !toBranchId || !(Number(quantity) > 0) || send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? "Moving…" : "Transfer"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto p-4">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : data && data.history.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">When</th><th>Ingredient</th><th>Quantity</th><th>Route</th><th className="text-right">Cost / unit</th></tr>
            </thead>
            <tbody>
              {data.history.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-1.5 whitespace-nowrap">{t.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{t.ingredientName}{t.note ? <span className="block text-xs text-muted-foreground">{t.note}</span> : null}</td>
                  <td className="tabular-nums">{t.quantity} {t.unit}</td>
                  <td><span className="inline-flex items-center gap-1.5">{t.fromBranchName} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> {t.toBranchName}</span></td>
                  <td className="text-right tabular-nums">{formatCurrency(Number(t.unitCost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No transfers yet.</p>
        )}
      </Card>
    </div>
  );
}
