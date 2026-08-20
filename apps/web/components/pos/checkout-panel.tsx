"use client";

import type { PaymentMethodDto } from "@nodedr-restaurant/types";
import { ArrowLeft, CheckCircle2, Printer } from "lucide-react";
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
import { CustomerPicker } from "@/components/pos/customer-picker";
import type { Customer } from "@/hooks/use-customers";
import { lookupGiftCard } from "@/hooks/use-gift-cards";
import { useCancelOrder, useCheckoutOrder, type CreatedOrder } from "@/hooks/use-orders";
import { usePrintOrderUsb } from "@/hooks/use-print";
import { useSettings } from "@/hooks/use-settings";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { openKotPrint, openReceiptPrint } from "@/lib/print";
import { round2 } from "@/lib/pricing-preview";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "WALLET"];

export function CheckoutPanel({
  order,
  branchId,
  initialCustomer = null,
  onDone,
}: {
  order: CreatedOrder;
  branchId: string | null;
  initialCustomer?: Customer | null;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethodDto>("CASH");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [tipAmount, setTipAmount] = useState("0");
  const [pointsToRedeem, setPointsToRedeem] = useState("0");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [checkingGiftCard, setCheckingGiftCard] = useState(false);
  const [splitCount, setSplitCount] = useState("1");
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer);
  const checkout = useCheckoutOrder(branchId);
  const cancelOrder = useCancelOrder(branchId);
  const printUsb = usePrintOrderUsb(branchId);
  const [completed, setCompleted] = useState<CreatedOrder | null>(null);
  const { data: settings } = useSettings(branchId);
  const loyaltyPointValue = Number(settings?.restaurant.loyaltyPointValue ?? 1);

  const discount = Number(discountPercent) || 0;
  const tip = Number(tipAmount) || 0;
  const points = Math.max(0, Math.floor(Number(pointsToRedeem) || 0));

  const afterDiscount = round2(Number(order.subtotal) * (1 - discount / 100));
  const loyaltyDiscount = round2(Math.min(points * loyaltyPointValue, afterDiscount));
  const totalDue = round2(afterDiscount - loyaltyDiscount + tip);

  const giftCardApplied = giftCardBalance !== null ? round2(Math.min(giftCardBalance, totalDue)) : 0;
  const remainingDue = round2(totalDue - giftCardApplied);

  const checkGiftCard = async () => {
    if (!giftCardCode) return;
    setCheckingGiftCard(true);
    try {
      const card = await lookupGiftCard(branchId, giftCardCode);
      if (!card) {
        toast.error("No gift card found with that code");
        setGiftCardBalance(null);
        return;
      }
      setGiftCardBalance(Number(card.balance));
    } finally {
      setCheckingGiftCard(false);
    }
  };

  const handleCheckout = () => {
    checkout.mutate(
      {
        orderId: order.id,
        dto: {
          customerId: customer?.id,
          discountPercent: discount,
          tipAmount: tip,
          loyaltyPointsToRedeem: points > 0 ? points : undefined,
          giftCardCode: giftCardBalance !== null ? giftCardCode : undefined,
          payments: remainingDue > 0 ? [{ method, amount: remainingDue }] : [],
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
        {Number(completed.loyaltyDiscountAmount) > 0 && (
          <p className="text-xs text-muted-foreground">
            {completed.loyaltyPointsRedeemed} points redeemed
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => branchId && openReceiptPrint(completed.id, branchId)}
          >
            Print receipt
          </Button>
          <Button
            variant="outline"
            disabled={printUsb.isPending}
            onClick={() =>
              printUsb.mutate(completed.id, {
                onSuccess: () => toast.success("Sent to the USB printer"),
                onError: (err) =>
                  toast.error(err instanceof ApiError ? err.message : "Could not print to USB printer"),
              })
            }
          >
            {printUsb.isPending ? "Printing…" : "Print via USB"}
          </Button>
          <Button onClick={onDone}>New order</Button>
        </div>
      </div>
    );
  }

  const handleCancel = () => {
    if (!confirm(`Cancel order #${order.orderNumber}? This can't be undone.`)) return;
    cancelOrder.mutate(order.id, {
      onSuccess: () => {
        toast.success(`Order #${order.orderNumber} cancelled`);
        onDone();
      },
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not cancel order"),
    });
  };

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 shrink-0 text-muted-foreground"
          onClick={onDone}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive"
          disabled={cancelOrder.isPending}
          onClick={handleCancel}
        >
          Cancel order
        </Button>
      </div>

      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">Order #{order.orderNumber} sent to kitchen</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => branchId && openKotPrint(order.id, branchId)}
          >
            <Printer className="h-4 w-4" />
            Print KOT
          </Button>
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {formatCurrency(order.subtotal)}
        </p>
        <p className="text-xs text-muted-foreground">incl. {formatCurrency(order.taxAmount)} tax</p>
        <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          No need to pay right now — tap <span className="font-medium text-foreground">Back</span> to
          help another table and come bill this one later from here or the Tables page.
        </p>
      </div>

      <CustomerPicker branchId={branchId} customer={customer} onSelect={setCustomer} />

      <div className="grid grid-cols-2 gap-4">
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
          <Label htmlFor="tip">Tip</Label>
          <Input
            id="tip"
            type="number"
            min="0"
            value={tipAmount}
            onChange={(e) => setTipAmount(e.target.value)}
          />
        </div>
      </div>

      {customer && customer.loyaltyPoints > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="points">Redeem loyalty points</Label>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() =>
                setPointsToRedeem(String(Math.min(customer.loyaltyPoints, Math.floor(afterDiscount))))
              }
            >
              Max ({customer.loyaltyPoints} available)
            </button>
          </div>
          <Input
            id="points"
            type="number"
            min="0"
            max={customer.loyaltyPoints}
            value={pointsToRedeem}
            onChange={(e) => setPointsToRedeem(e.target.value)}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="gift-card">Gift card code (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="gift-card"
            value={giftCardCode}
            onChange={(e) => {
              setGiftCardCode(e.target.value);
              setGiftCardBalance(null);
            }}
            placeholder="e.g. 8A7B629E8EEA"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!giftCardCode || checkingGiftCard}
            onClick={checkGiftCard}
          >
            {checkingGiftCard ? "…" : "Check"}
          </Button>
        </div>
        {giftCardBalance !== null && (
          <p className="text-xs text-success">
            Balance {formatCurrency(giftCardBalance)} — applying {formatCurrency(giftCardApplied)}
          </p>
        )}
      </div>

      {remainingDue > 0 && (
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
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
        <Label htmlFor="split" className="text-xs text-muted-foreground">
          Split between
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="split"
            type="number"
            min="1"
            value={splitCount}
            onChange={(e) => setSplitCount(e.target.value)}
            className="h-8 w-16 text-center"
          />
          <span className="text-xs text-muted-foreground">guests</span>
        </div>
      </div>
      {Number(splitCount) > 1 && (
        <p className="-mt-2 text-center text-xs text-muted-foreground">
          {formatCurrency(round2(totalDue / Number(splitCount)))} each — collect separately, then
          complete payment once for the whole table.
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total due</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatCurrency(totalDue)}
          </span>
        </div>
        {giftCardApplied > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Remaining after gift card</span>
            <span>{formatCurrency(remainingDue)}</span>
          </div>
        )}
        <Button className="h-11" disabled={checkout.isPending} onClick={handleCheckout}>
          {checkout.isPending ? "Processing…" : "Complete payment"}
        </Button>
      </div>
    </div>
  );
}
