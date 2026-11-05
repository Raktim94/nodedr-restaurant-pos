"use client";

import { PaymentMethodButtons } from "@/components/pos/payment-method-buttons";
import type { PaymentMethodDto } from "@nodedr-restaurant/types";
import { RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "@/lib/toast";
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
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import { useRefundOrder } from "@/hooks/use-orders";
import { useGatewayRefund, useOrderGatewayPayments } from "@/hooks/use-payment-gateways";
import { fromMinorUnits } from "@/lib/money-units";
import { api, ApiError } from "@/lib/api";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "OTHER", "STORE_CREDIT"];

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
  const gatewayRefund = useGatewayRefund(branchId);
  // An online payment that can be sent back to the customer's own card/UPI.
  const gw = useOrderGatewayPayments(branchId, orderId, open);
  const online = gw.data?.find((p) => p.refundableMinor > 0) ?? null;
  const [viaGateway, setViaGateway] = useState(true);
  const useGateway = !!online && viaGateway;
  const onlineMax = online ? fromMinorUnits(online.refundableMinor, online.currency) : 0;
  const pending = refund.isPending || gatewayRefund.isPending;
  // Units physically handed back; only these go back into stock.
  const [returned, setReturned] = useState<Record<string, number>>({});
  const { data: order } = useQuery({
    queryKey: ["orders", "refund-items", branchId, orderId],
    queryFn: () => api.get<{ items: { id: string; nameSnapshot: string; quantity: number }[] }>(`/orders/${orderId}?branchId=${branchId}`),
    enabled: open && !!branchId,
  });

  const returnedItems = () =>
    Object.entries(returned)
      .filter(([, quantity]) => quantity > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (useGateway && online) {
      gatewayRefund.mutate(
        { paymentId: online.id, amount: Number(amount), reason: reason || undefined, returnedItems: returnedItems() },
        {
          onSuccess: () => {
            toast.success(`Sent ${amount} back to the customer's original payment on order #${orderNumber}`);
            setOpen(false);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : "Refund failed"),
        },
      );
      return;
    }
    refund.mutate(
      {
        orderId,
        dto: {
          amount: Number(amount),
          method,
          reason: reason || undefined,
          returnedItems: Object.entries(returned)
            .filter(([, quantity]) => quantity > 0)
            .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        },
      },
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
          <Button variant="ghost" size="icon" aria-label={`Refund order ${orderNumber}`} title="Refund" className="h-8 w-8 text-muted-foreground hover:text-destructive">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Refund order #{orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-amount">Amount (max {useGateway ? Math.min(maxAmount, onlineMax) : maxAmount})</Label>
            <Input
              id="refund-amount"
              type="number"
              min="0"
              max={useGateway ? Math.min(maxAmount, onlineMax) : maxAmount}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </div>
          {online && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="refund-via-gw" className="font-medium">Send it back to the customer&apos;s original payment</Label>
                  <p className="text-xs text-muted-foreground">
                    {online.provider} · up to {formatCurrency(onlineMax, online.currency)} of this online payment can still be refunded. It reaches the customer in the provider&apos;s normal refund time.
                  </p>
                </div>
                <Switch id="refund-via-gw" checked={viaGateway} onCheckedChange={setViaGateway} />
              </div>
              {useGateway && <p className="text-xs text-muted-foreground">This is sent once and cannot be recalled. It is recorded here only after the provider accepts it.</p>}
            </div>
          )}
          {!useGateway && (
            <div className="flex flex-col gap-2">
              <Label>Refund method</Label>
              <PaymentMethodButtons methods={METHODS} value={method} onChange={setMethod} label="Refund method" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="refund-reason">Reason (optional)</Label>
            <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {order && order.items.length > 0 && (
            <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Returned to stock</legend>
              <p className="text-xs text-muted-foreground">
                A refund alone does not change stock. Enter only the units that physically came back and can be reused.
              </p>
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <Label htmlFor={`ret-${item.id}`} className="min-w-0 flex-1 truncate">
                    {item.nameSnapshot} <span className="text-muted-foreground">(sold {item.quantity})</span>
                  </Label>
                  <Input
                    id={`ret-${item.id}`}
                    type="number"
                    min="0"
                    max={item.quantity}
                    step="1"
                    className="h-9 w-20"
                    value={returned[item.id] ?? 0}
                    onChange={(e) =>
                      setReturned({ ...returned, [item.id]: Math.max(0, Math.min(item.quantity, Math.floor(Number(e.target.value) || 0))) })
                    }
                  />
                </div>
              ))}
            </fieldset>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Refunding…" : useGateway ? `Refund ${amount || ""} to the original payment`.trim() : "Issue refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
