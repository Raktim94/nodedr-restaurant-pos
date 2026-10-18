"use client";

import type { PaymentMethodDto } from "@nodedr-restaurant/types";
import { ArrowLeft, CheckCircle2, Pencil, Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentMethodButtons } from "@/components/pos/payment-method-buttons";
import { CustomerPicker } from "@/components/pos/customer-picker";
import type { Customer } from "@/hooks/use-customers";
import { lookupGiftCard } from "@/hooks/use-gift-cards";
import { CancelOrderDialog, useCanCancelOrders } from "@/components/orders/cancel-order-dialog";
import { EditBillDialog } from "@/components/orders/edit-bill-dialog";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useCheckoutOrder, useOrder, type CreatedOrder } from "@/hooks/use-orders";
import { usePrintKot, usePrintOrderUsb, type PrintJobResult } from "@/hooks/use-print";
import { useSettings } from "@/hooks/use-settings";
import { api, ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { publishDisplay } from "@/lib/customer-display";
import { playPaymentReceived } from "@/lib/celebrate";
import { buildUpiUri } from "@/lib/upi";
import { QRCodeSVG } from "qrcode.react";
import { openKotPrint, openReceiptPrint } from "@/lib/print";
import { round2 } from "@/lib/pricing-preview";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "OTHER"];

export function CheckoutPanel({
  order: orderSnapshot,
  branchId,
  initialCustomer = null,
  onDone,
}: {
  order: CreatedOrder;
  branchId: string | null;
  initialCustomer?: Customer | null;
  onDone: () => void;
}) {
  // The order passed in is a snapshot from when it was sent; the live copy
  // carries edits (removed lines, new totals) and a cancel/pay by someone else.
  const { data: live } = useOrder(branchId, orderSnapshot.id);
  const order: CreatedOrder = live
    ? {
        ...orderSnapshot,
        subtotal: live.subtotal,
        taxAmount: live.taxAmount,
        totalAmount: live.totalAmount,
        status: live.status,
      }
    : orderSnapshot;
  const [method, setMethod] = useState<PaymentMethodDto>("CASH");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [tipAmount, setTipAmount] = useState("0");
  const [pointsToRedeem, setPointsToRedeem] = useState("0");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [checkingGiftCard, setCheckingGiftCard] = useState(false);
  const [splitCount, setSplitCount] = useState("1");
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const checkout = useCheckoutOrder(branchId);
  const { note, clear: clearNote, toast } = useNoteToast();
  const canCancelRole = useCanCancelOrders();
  const { data: me } = useCurrentUser();
  const canEditRole = hasPermission(me?.user, "orders.edit");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const printUsb = usePrintOrderUsb(branchId);
  const printKot = usePrintKot(branchId);
  const onPrinted = (r: PrintJobResult) =>
    r.unsupportedChars?.length
      ? toast.warning(`Sent, but ${r.unsupportedChars.join(" ")} cannot be printed by this printer's code page. Use browser print for the full text.`)
      : toast.success("Sent to the thermal printer");
  // First print sends only tickets not yet printed. If they already went out
  // (e.g. a double tap or retry) the server refuses to print a duplicate and we
  // offer an explicit, REPRINT-stamped copy instead.
  const printKotNow = (reprint: boolean) =>
    printKot.mutate(
      { orderId: order.id, reprint },
      {
        onSuccess: (r) => {
          onPrinted(r);
          if (reprint) toast.success("Reprint sent — marked REPRINT on paper");
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "ALREADY_PRINTED") {
            toast.info("The kitchen ticket was already printed", {
              action: { label: "Print a REPRINT", onClick: () => printKotNow(true) },
            });
            return;
          }
          toast.error(err instanceof ApiError ? err.message : "Could not print to the kitchen printer");
        },
      },
    );
  const [completed, setCompleted] = useState<CreatedOrder | null>(null);
  const { data: settings } = useSettings(branchId);
  const loyaltyPointValue = Number(settings?.restaurant.loyaltyPointValue ?? 1);

  const discount = Number(discountPercent) || 0;
  const tip = Number(tipAmount) || 0;
  const points = Math.max(0, Math.floor(Number(pointsToRedeem) || 0));

  // The server decides coupon / happy-hour discounts; ask it what would apply
  // so the amount due shown here matches what checkout will charge.
  const fetchPreview = (couponCode?: string) =>
    api.post<{ amount: number; couponCode: string | null; promotionName: string | null }>(
      `/orders/${order.id}/discount-preview?branchId=${branchId}`,
      { couponCode },
    );
  const preview = useQuery({
    queryKey: ["discount-preview", order.id, appliedCoupon],
    queryFn: () => fetchPreview(appliedCoupon || undefined),
    enabled: !!branchId,
    retry: false,
  });
  // A coupon is checked when applied, so the preview above only ever sees a
  // valid code (or none) and never drops the happy-hour discount on an error.
  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return setAppliedCoupon("");
    try {
      await fetchPreview(code);
      setAppliedCoupon(code);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply coupon");
    }
  };
  const autoDiscount = preview.data?.amount ?? 0;
  const subtotalNum = Number(order.subtotal);
  const manualDiscount = (subtotalNum * discount) / 100;
  const afterDiscount = round2(Math.max(0, subtotalNum - Math.min(manualDiscount + autoDiscount, subtotalNum)));
  const loyaltyDiscount = round2(Math.min(points * loyaltyPointValue, afterDiscount));
  const deliveryFee = Number(order.deliveryFee ?? 0);
  const totalDue = round2(afterDiscount - loyaltyDiscount + tip + deliveryFee);

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

  const upiUri = useMemo(() => {
    const vpa = settings?.restaurant.upiVpa;
    if (method !== "UPI" || !vpa || !(remainingDue > 0)) return null;
    return buildUpiUri({
      vpa,
      name: settings?.restaurant.upiPayeeName || settings?.restaurant.name,
      amount: remainingDue,
      note: `Order ${order.id.slice(-6).toUpperCase()}`,
      ref: order.id,
    });
  }, [method, settings, remainingDue, order.id]);

  // Mirror the QR to the customer-facing screen while UPI is selected, and
  // clear it again if the cashier switches method.
  useEffect(() => {
    if (completed) return;
    if (upiUri) {
      publishDisplay({
        kind: "upi",
        total: remainingDue,
        uri: upiUri,
        payee: settings?.restaurant.upiPayeeName || settings?.restaurant.name || "",
      });
    }
  }, [upiUri, remainingDue, completed, settings]);

  const handleCheckout = () => {
    checkout.mutate(
      {
        orderId: order.id,
        dto: {
          customerId: customer?.id,
          discountPercent: discount,
          couponCode: preview.data?.couponCode ?? undefined,
          tipAmount: tip,
          loyaltyPointsToRedeem: points > 0 ? points : undefined,
          giftCardCode: giftCardBalance !== null ? giftCardCode : undefined,
          payments: remainingDue > 0 ? [{ method, amount: remainingDue }] : [],
        },
      },
      {
        onSuccess: (result) => {
          setCompleted(result);
          publishDisplay({ kind: "paid", total: Number(result.totalAmount), method });
          playPaymentReceived(formatCurrency(result.totalAmount));
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
        <StatusNote note={note} onClear={clearNote} className="w-full text-left" />
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
            Print / PDF (browser)
          </Button>
          <Button
            variant="outline"
            disabled={printUsb.isPending}
            onClick={() =>
              printUsb.mutate({ orderId: completed.id, drawer: completed.payments?.some((p) => p.method === "CASH") }, {
                onSuccess: onPrinted,
                onError: (err) =>
                  toast.error(err instanceof ApiError ? err.message : "Could not print to the thermal printer"),
              })
            }
          >
            {printUsb.isPending ? "Printing…" : "Thermal print"}
          </Button>
          <Button onClick={onDone}>New order</Button>
        </div>
      </div>
    );
  }

  // Someone else (another terminal) already closed this bill.
  if (order.status === "CANCELLED" || (order.status === "PAID" && !completed)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <StatusNote note={note} onClear={clearNote} className="w-full text-left" />
        <p className="text-sm font-medium text-foreground">
          Order #{order.orderNumber} was {order.status === "CANCELLED" ? "cancelled" : "already paid"}
        </p>
        <p className="text-xs text-muted-foreground">
          {order.status === "CANCELLED"
            ? "The kitchen tickets were withdrawn and the table is free again. The order stays in History."
            : "Nothing more to do here."}
        </p>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto">
      <StatusNote note={note} onClear={clearNote} />
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <div className="flex flex-wrap justify-end gap-2">
          {canEditRole && (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit bill
            </Button>
          )}
          {canCancelRole && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              Cancel order
            </Button>
          )}
        </div>
        <CancelOrderDialog
          branchId={branchId}
          orderId={order.id}
          orderNumber={order.orderNumber}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
        <EditBillDialog branchId={branchId} orderId={order.id} open={editOpen} onOpenChange={setEditOpen} />
      </div>

      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm text-muted-foreground">Order #{order.orderNumber} sent to kitchen</p>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => branchId && openKotPrint(order.id, branchId)}
          >
            <Printer className="h-4 w-4" />
            KOT (browser)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={printKot.isPending}
            onClick={() => printKotNow(false)}
          >
            <Printer className="h-4 w-4" />
            {printKot.isPending ? "Printing…" : "KOT (thermal)"}
          </Button>
          </div>
        </div>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
          {formatCurrency(order.subtotal)}
        </p>
        <p className="text-xs text-muted-foreground">incl. {formatCurrency(order.taxAmount)} tax</p>
        {Number(order.deliveryFee ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            + {formatCurrency(order.deliveryFee ?? 0)} delivery fee (added at payment)
          </p>
        )}
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
        <Label htmlFor="coupon">Coupon code (optional)</Label>
        <div className="flex gap-2">
          <Input
            id="coupon"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            placeholder="e.g. SAVE10"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!couponInput.trim() && !appliedCoupon}
            onClick={applyCoupon}
          >
            Apply
          </Button>
        </div>
        {preview.data && preview.data.amount > 0 && (
          <p className="text-xs text-success">
            {preview.data.couponCode
              ? `Coupon ${preview.data.couponCode}`
              : `${preview.data.promotionName}`}{" "}
            — {formatCurrency(preview.data.amount)} off
          </p>
        )}
      </div>

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
          <PaymentMethodButtons methods={METHODS} value={method} onChange={setMethod} />
        </div>
      )}

      {method === "UPI" && remainingDue > 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-4">
          {upiUri ? (
            <>
              <QRCodeSVG value={upiUri} size={176} level="M" marginSize={1} />
              <p className="text-xs font-medium text-[#17251d]">
                Scan with any UPI app · {formatCurrency(remainingDue)} pre-filled
              </p>
              <p className="text-[11px] text-neutral-500">Also shown on the customer display</p>
            </>
          ) : (
            <p className="text-center text-xs text-neutral-600">
              No UPI id set yet. <Link href="/settings" className="font-medium underline">Add your UPI id in Settings → Restaurant</Link> to show a payment QR here.
            </p>
          )}
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
