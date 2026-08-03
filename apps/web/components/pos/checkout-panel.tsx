"use client";

import type { PaymentMethodDto } from "@nodedr-restaurant/types";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCheckoutOrder, type CreatedOrder } from "@/hooks/use-orders";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "WALLET"];

export function CheckoutPanel({
  order,
  branchId,
  onDone,
}: {
  order: CreatedOrder;
  branchId: string | null;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethodDto>("CASH");
  const [discountPercent, setDiscountPercent] = useState("0");
  const checkout = useCheckoutOrder(branchId);
  const [completed, setCompleted] = useState<CreatedOrder | null>(null);

  const discount = Number(discountPercent) || 0;
  const estimatedTotal =
    Math.round(Number(order.subtotal) * (1 - discount / 100) * 100) / 100;

  const handleCheckout = () => {
    checkout.mutate(
      {
        orderId: order.id,
        dto: {
          discountPercent: discount,
          payments: [{ method, amount: estimatedTotal }],
        },
      },
      {
        onSuccess: (result) => {
          setCompleted(result);
          toast.success("Payment recorded");
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Checkout failed"),
      },
    );
  };

  if (completed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <p className="text-lg font-semibold text-foreground">
          Order #{order.orderNumber} paid
        </p>
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {formatCurrency(completed.totalAmount)}
        </p>
        <Button className="mt-4" onClick={onDone}>
          New order
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <div>
        <p className="text-sm text-muted-foreground">Order #{order.orderNumber} sent to kitchen</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {formatCurrency(order.subtotal)}
        </p>
        <p className="text-xs text-muted-foreground">
          incl. {formatCurrency(order.taxAmount)} tax
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="discount">Discount %</Label>
        <Input
          id="discount"
          type="number"
          min="0"
          max="100"
          value={discountPercent}
          onChange={(e) => setDiscountPercent(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Payment method</Label>
        <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethodDto)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total due</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatCurrency(estimatedTotal)}
          </span>
        </div>
        <Button className="h-11" disabled={checkout.isPending} onClick={handleCheckout}>
          {checkout.isPending ? "Processing…" : "Complete payment"}
        </Button>
      </div>
    </div>
  );
}
