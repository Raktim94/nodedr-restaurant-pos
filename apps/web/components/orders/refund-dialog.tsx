"use client";

import type { PaymentMethodDto } from "@nodedr-restaurant/types";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRefundOrder } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "STORE_CREDIT"];

export function RefundDialog({
  branchId,
  orderId,
  orderNumber,
  maxAmount,
}: {
  branchId: string | null;
  orderId: string;
  orderNumber: string;
  maxAmount: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(maxAmount));
  const [method, setMethod] = useState<PaymentMethodDto>("CASH");
  const [reason, setReason] = useState("");
  const refund = useRefundOrder(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    refund.mutate(
      { orderId, dto: { amount: Number(amount), method, reason: reason || undefined } },
      {
        onSuccess: () => {
          toast.success(`Refunded ${amount} on order #${orderNumber}`);
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Refund failed"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Refund order #{orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-amount">Amount (max {maxAmount})</Label>
            <Input
              id="refund-amount"
              type="number"
              min="0"
              max={maxAmount}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Refund method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethodDto)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m === "STORE_CREDIT" ? "Store credit" : m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={refund.isPending}>
              {refund.isPending ? "Refunding…" : "Issue refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
