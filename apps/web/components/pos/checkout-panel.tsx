"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { kitchenProgress, type PaymentMethodDto } from "@nodedr-restaurant/types";
import { CheckCircle2, ChefHat, Pencil, Printer, QrCode } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
import { OnlinePayment } from "@/components/pos/online-payment";
import { BillShareDialog } from "@/components/pos/bill-share-dialog";
import { PaymentMethodButtons } from "@/components/pos/payment-method-buttons";
import { CustomerPicker } from "@/components/pos/customer-picker";
import type { Customer } from "@/hooks/use-customers";
import { lookupGiftCard } from "@/hooks/use-gift-cards";
import { CancelOrderDialog, useCanCancelOrders } from "@/components/orders/cancel-order-dialog";
import { EditBillDialog } from "@/components/orders/edit-bill-dialog";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import {
  useBillPreview,
  useCheckoutOrder,
  useOrder,
  type BillPreview,
  type CheckoutResult,
  type CreatedOrder,
} from "@/hooks/use-orders";
import { usePrintKot, usePrintOrderUsb, type PrintJobResult } from "@/hooks/use-print";
import { useDisplaySettings } from "@/hooks/use-settings";
import { api, ApiError } from "@/lib/api";
import { discountSummary, parseMoney, planPayment } from "@/lib/bill";
import { cn } from "@/lib/utils";
import { publishDisplay } from "@/lib/customer-display";
import { playPaymentReceived } from "@/lib/celebrate";
import { buildUpiUri } from "@/lib/upi";
import { QRCodeSVG } from "qrcode.react";
import { canPrintOnDevice } from "@/lib/device-print";
import { openKotPrint, openReceiptPrint } from "@/lib/print";
import { round2 } from "@/lib/pricing-preview";

const METHODS: PaymentMethodDto[] = ["CASH", "CARD", "UPI", "OTHER"];

const KITCHEN_LABEL: Record<string, string> = {
  NEW: "Waiting for the kitchen",
  ACCEPTED: "Kitchen accepted",
  PREPARING: "Being prepared",
  READY: "Ready to serve",
  SERVED: "Served",
};

/** Re-evaluates a value after the user has stopped changing it for `ms`. */
function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

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
  const fmt = useStaffFormat();
  const { t } = useI18n();
  // The order passed in is a snapshot from when it was sent; the live copy
  // carries edits (removed lines, new totals), payments already taken, the
  // kitchen's progress, and a cancel/pay by someone else.
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
  const [amountText, setAmountText] = useState("");
  // The cashier enters either a percentage or a fixed cash amount; the server
  // prices both the same way (and enforces the cap and the reason rule).
  const [discountMode, setDiscountMode] = useState<"PERCENT" | "FLAT">("PERCENT");
  const [discountValue, setDiscountValue] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
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
  const canDiscount = hasPermission(me?.user, "discounts.apply");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOrderId, setShareOrderId] = useState<string | null>(null);
  const phone = canPrintOnDevice();
  const printUsb = usePrintOrderUsb(branchId);
  const printKot = usePrintKot(branchId);
  const onPrinted = (r: PrintJobResult) =>
    r.unsupportedChars?.length
      ? toast.warning(t("Sent, but {join} cannot be printed by this printer's code page. Use browser print for the full text.", { join: r.unsupportedChars.join(" ") }))
      : toast.success(t("Sent to the thermal printer"));
  // First print sends only tickets not yet printed. If they already went out
  // (e.g. a double tap or retry) the server refuses to print a duplicate and we
  // offer an explicit, REPRINT-stamped copy instead.
  const printKotNow = (reprint: boolean) =>
    printKot.mutate(
      { orderId: order.id, reprint },
      {
        onSuccess: (r) => {
          onPrinted(r);
          if (reprint) toast.success(t("Reprint sent — marked REPRINT on paper"));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "ALREADY_PRINTED") {
            toast.info(t("The kitchen ticket was already printed"), {
              action: { label: t("Print a REPRINT"), onClick: () => printKotNow(true) },
            });
            return;
          }
          toast.error(err instanceof Error ? err.message : t("Could not print to the kitchen printer"));
        },
      },
    );
  const [completed, setCompleted] = useState<CheckoutResult | null>(null);
  const { data: settings } = useDisplaySettings(branchId);

  // What the guest has typed in, as numbers. Once a payment has been taken the
  // server locks the figures, so these stop mattering (and are not sent).
  const adjustments = useMemo(
    () => ({
      ...(discountMode === "PERCENT"
        ? { discountPercent: Math.min(Number(discountValue) || 0, 100) }
        : { discountFlat: Number(discountValue) || 0 }),
      tipAmount: Number(tipAmount) || 0,
      loyaltyPointsToRedeem: Math.max(0, Math.floor(Number(pointsToRedeem) || 0)),
      couponCode: appliedCoupon || undefined,
    }),
    [discountMode, discountValue, tipAmount, pointsToRedeem, appliedCoupon],
  );
  const settled = useDebounced(adjustments);
  // Once any payment is on the bill the server fixes its figures and refuses
  // further adjustments, so none are sent from then on.
  const hasPayments = (live?.payments.length ?? 0) > 0;

  // The server prices the bill: this is the single source for the figures on
  // screen, on the printed bill, and at checkout.
  const billQuery = useBillPreview(
    branchId,
    order.id,
    hasPayments ? {} : settled,
    order.status === "OPEN",
  );
  const bill: BillPreview | undefined = billQuery.data;
  const locked = (bill?.locked ?? false) || hasPayments;
  const repricing = adjustments !== settled;
  // The preview already includes the current redemption, so add it back to get
  // the amount available to redeem against. A point's value is configured per
  // restaurant; using 1 here silently over-redeems when it is set to e.g. 2.
  const pointValue = Number(settings?.restaurant.loyaltyPointValue ?? 0);
  const preLoyaltyTotal = round2(
    (bill?.totalDue ?? 0) + (bill?.loyaltyDiscountAmount ?? 0),
  );
  const maxRedeemablePoints =
    pointValue > 0
      ? Math.max(0, Math.floor(preLoyaltyTotal / pointValue))
      : 0;

  // A coupon is checked when applied, so the bill above only ever sees a valid
  // code (or none) and never drops the happy-hour discount on an error.
  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return setAppliedCoupon("");
    try {
      // Validate this code on its own before adopting it.
      await api.post(`/orders/${order.id}/bill-preview?branchId=${branchId}`, { couponCode: code });
      setAppliedCoupon(code);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("Could not apply coupon"));
    }
  };

  const balance = bill?.balanceDue ?? 0;
  const giftCardApplied = giftCardBalance !== null ? round2(Math.min(giftCardBalance, balance)) : 0;
  const remainingDue = round2(balance - giftCardApplied);
  const entered = parseMoney(amountText);
  const plan = planPayment({ remaining: remainingDue, entered, method });
  const split = Math.max(1, Math.floor(Number(splitCount) || 1));

  const checkGiftCard = async () => {
    if (!giftCardCode) return;
    setCheckingGiftCard(true);
    try {
      const card = await lookupGiftCard(branchId, giftCardCode);
      if (!card) {
        toast.error(t("No gift card found with that code"));
        setGiftCardBalance(null);
        return;
      }
      setGiftCardBalance(Number(card.balance));
    } catch {
      setGiftCardBalance(null);
      toast.error(t("Could not check the gift card. Check the connection and try again."));
    } finally {
      setCheckingGiftCard(false);
    }
  };

  // What the QR asks the guest to pay: the amount being recorded now.
  const upiAmount = plan.valid ? plan.applied : remainingDue;
  const upiVpa = settings?.restaurant.upiVpa;
  const upiName = settings?.restaurant.upiPayeeName || settings?.restaurant.name;
  const upiUri =
    method !== "UPI" || !upiVpa || !(upiAmount > 0)
      ? null
      : buildUpiUri({
          vpa: upiVpa,
          name: upiName,
          amount: upiAmount,
          note: `Order ${order.id.slice(-6).toUpperCase()}`,
          ref: order.id,
        });

  // Mirror the QR to the customer-facing screen while UPI is selected, and
  // clear it again if the cashier switches method.
  useEffect(() => {
    if (completed) return;
    if (upiUri) {
      publishDisplay({ kind: "upi", total: upiAmount, uri: upiUri, payee: upiName || "" });
    } else {
      // Switching to cash (or covering the balance with a gift card) must
      // remove the QR from the customer screen, not leave the last amount
      // showing while the cashier takes a different tender.
      publishDisplay({ kind: "idle" });
    }
  }, [upiUri, upiAmount, upiName, completed]);

  // One id per distinct attempt: a retry after a dropped connection (same
  // payload) reuses it, so the server records the payment once.
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const requestIdFor = (payload: unknown) => {
    const key = JSON.stringify(payload);
    if (attempt.current?.key !== key) {
      attempt.current = { key, id: crypto.randomUUID() };
    }
    return attempt.current.id;
  };

  const handleCheckout = () => {
    // placeholderData keeps the previous bill on screen while the preview
    // refetches. Never charge against those stale figures.
    if (!bill || repricing || billQuery.isFetching) return;
    const payments =
      plan.applied > 0
        ? [
            {
              method,
              amount: plan.applied,
              ...(plan.tendered ? { tendered: plan.tendered } : {}),
            },
          ]
        : [];
    const dto = {
      customerId: customer?.id,
      ...(locked ? {} : settled),
      ...(!locked && Number(discountValue) > 0 && discountReason.trim()
        ? { discountReason: discountReason.trim() }
        : {}),
      giftCardCode: giftCardBalance !== null ? giftCardCode : undefined,
      payments,
      allowPartial: plan.partial || undefined,
    };
    checkout.mutate(
      { orderId: order.id, dto: { ...dto, requestId: requestIdFor(dto) } },
      {
        onSuccess: (result) => {
          attempt.current = null;
          setAmountText("");
          if (result.settlement.fullyPaid) {
            setCompleted(result);
            publishDisplay({ kind: "paid", total: Number(result.totalAmount), method });
            playPaymentReceived(fmt.currency(result.totalAmount));
            toast.success(t("Payment recorded"));
          } else {
            toast.success(
              t("Part payment of {formatCurrency} recorded — {formatCurrency2} still due", { formatCurrency: fmt.currency(result.settlement.amountPaid), formatCurrency2: fmt.currency(result.settlement.balanceDue) }),
            );
          }
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : t("Checkout failed")),
      },
    );
  };

  const printBill = () => branchId && openReceiptPrint(t, order.id, branchId, locked ? {} : settled);
  const printBillThermal = () =>
    printUsb.mutate(
      { orderId: order.id, adjustments: locked ? {} : settled },
      {
        onSuccess: onPrinted,
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : t("Could not print to the thermal printer")),
      },
    );

  if (completed) {
    const { settlement } = completed;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <StatusNote note={note} onClear={clearNote} className="w-full text-left" />
        <CheckCircle2 className="h-10 w-10 text-success" />
        <p className="text-lg font-semibold text-foreground">{t("Order #{orderNumber} paid", { orderNumber: order.orderNumber })}</p>
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {fmt.currency(completed.totalAmount)}
        </p>
        {settlement.changeDue > 0 && (
          <p className="rounded-lg bg-success/10 px-4 py-2 text-lg font-semibold tabular-nums text-success">{t("Change due {formatCurrency}", { formatCurrency: fmt.currency(settlement.changeDue) })}</p>
        )}
        {Number(completed.loyaltyDiscountAmount) > 0 && (
          <p className="text-xs text-muted-foreground">{t("{loyaltyPointsRedeemed} points redeemed", { loyaltyPointsRedeemed: completed.loyaltyPointsRedeemed })}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => branchId && openReceiptPrint(t, completed.id, branchId)}
          >
            {phone ? t("Print / Save PDF") : t("Print receipt (browser)")}
          </Button>
          <Button
            variant="outline"
            className="h-11"
            disabled={printUsb.isPending}
            onClick={() =>
              printUsb.mutate({ orderId: completed.id, drawer: completed.payments?.some((p) => p.method === "CASH") }, {
                onSuccess: onPrinted,
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : t("Could not print to the thermal printer")),
              })
            }
          >
            {printUsb.isPending ? t("Printing…") : phone ? t("Bluetooth receipt") : t("Thermal receipt")}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => setShareOrderId(completed.id)}>
            <QrCode className="h-4 w-4" />
            {t("Share receipt (QR)")}
          </Button>
          <Button className="h-11" onClick={onDone}>{t("New order")}</Button>
        </div>
        <BillShareDialog
          orderId={shareOrderId ?? ""}
          branchId={branchId}
          adjustments={{}}
          open={!!shareOrderId}
          onOpenChange={(o) => !o && setShareOrderId(null)}
        />
      </div>
    );
  }

  // Someone else (another terminal) already closed this bill.
  if (order.status === "CANCELLED" || (order.status === "PAID" && !completed)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <StatusNote note={note} onClear={clearNote} className="w-full text-left" />
        <p className="text-sm font-medium text-foreground">{t("Order #{orderNumber} was", { orderNumber: order.orderNumber })} {order.status === "CANCELLED" ? t("cancelled") : t("already paid")}
        </p>
        <p className="text-xs text-muted-foreground">
          {order.status === "CANCELLED"
            ? t("The kitchen tickets were withdrawn and the table is free again. The order stays in History.")
            : t("Nothing more to do here.")}
        </p>
        <Button className="h-11" onClick={onDone}>{t("Done")}</Button>
      </div>
    );
  }

  const kitchen = live ? kitchenProgress(live.kots.map((k) => k.status)) : null;
  const paidSoFar = live?.payments ?? [];
  const partialLabel = t("Record partial payment · {currency}", { currency: fmt.currency(plan.applied) });

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto">
      <StatusNote note={note} onClear={clearNote} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          {canEditRole && !locked && (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              {t("Edit bill")}
            </Button>
          )}
          {canCancelRole && !locked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              {t("Cancel order")}
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
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t("Order #{orderNumber} sent to kitchen", { orderNumber: order.orderNumber })}</p>
            {kitchen && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <ChefHat className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {fmt.label(KITCHEN_LABEL[kitchen])}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => branchId && openKotPrint(t, order.id, branchId)}
          >
            <Printer className="h-4 w-4" />
            {phone ? t("KOT / PDF") : t("KOT (browser)")}
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
            {printKot.isPending ? t("Printing…") : phone ? t("KOT (Bluetooth)") : t("KOT (thermal)")}
          </Button>
          </div>
        </div>
        {!locked && (
          <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            {t("No need to pay right now — use the buttons at the top to go back, and bill this one later from here or the Tables page.")}
          </p>
        )}
      </div>

      {paidSoFar.length > 0 && (
        <div className="rounded-xl border border-border px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">{t("Payments so far")}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {paidSoFar.map((p) => (
              <li key={p.id} className="flex justify-between tabular-nums">
                <span>{fmt.code(p.method)}</span>
                <span>{fmt.currency(p.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Discount, tip and points are locked until this bill is settled.")}
          </p>
        </div>
      )}

      <CustomerPicker branchId={branchId} customer={customer} onSelect={setCustomer} />

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="discount">{t("Discount")}</Label>
            <div role="group" aria-label={t("Discount type")} className="flex overflow-hidden rounded-lg border border-border text-xs">
              {(["PERCENT", "FLAT"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={discountMode === m}
                  disabled={locked || !canDiscount}
                  onClick={() => {
                    setDiscountMode(m);
                    setDiscountValue("0");
                  }}
                  className={cn(
                    "min-h-8 px-2.5 font-medium transition-colors disabled:opacity-50",
                    discountMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {m === "PERCENT" ? "%" : t("Amount")}
                </button>
              ))}
            </div>
          </div>
          <Input
            id="discount"
            type="number"
            min="0"
            max={discountMode === "PERCENT" ? 100 : undefined}
            inputMode="decimal"
            className="h-11"
            value={discountValue}
            disabled={locked || !canDiscount}
            onChange={(e) => setDiscountValue(e.target.value)}
          />
          {canDiscount && !locked && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Discount presets")}>
              {(discountMode === "PERCENT" ? [5, 10, 15, 20] : [10, 20, 50, 100]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setDiscountValue(String(v))}
                  className="min-h-8 rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
                >
                  {discountMode === "PERCENT" ? `${v}%` : fmt.currency(v)}
                </button>
              ))}
            </div>
          )}
          {!canDiscount && (
            <p className="text-[11px] text-muted-foreground">{t("Your role cannot apply discounts.")}</p>
          )}
          {canDiscount && !locked && Number(discountValue) > 0 && (
            <Input
              aria-label={t("Discount reason")}
              placeholder={t("Reason for discount")}
              maxLength={200}
              className="h-9 text-sm"
              value={discountReason}
              onChange={(e) => setDiscountReason(e.target.value)}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="tip">{t("Tip")}</Label>
          <Input
            id="tip"
            type="number"
            min="0"
            className="h-11"
            value={tipAmount}
            disabled={locked}
            onChange={(e) => setTipAmount(e.target.value)}
          />
        </div>
      </div>

      {customer && customer.loyaltyPoints > 0 && !locked && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="points">{t("Redeem loyalty points")}</Label>
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() =>
                setPointsToRedeem(
                  String(Math.min(customer.loyaltyPoints, maxRedeemablePoints)),
                )
              }
            >{t("Max ({loyaltyPoints} available)", { loyaltyPoints: customer.loyaltyPoints })}</button>
          </div>
          <Input
            id="points"
            type="number"
            min="0"
            max={Math.min(customer.loyaltyPoints, maxRedeemablePoints)}
            className="h-11"
            value={pointsToRedeem}
            onChange={(e) => setPointsToRedeem(e.target.value)}
          />
        </div>
      )}

      {canDiscount && !locked && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="coupon">{t("Coupon code (optional)")}</Label>
          <div className="flex gap-2">
            <Input
              id="coupon"
              className="h-11"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
              placeholder={t("e.g. SAVE10")}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={!couponInput.trim() && !appliedCoupon}
              onClick={applyCoupon}
            >
              {t("Apply")}
            </Button>
          </div>
        </div>
      )}

      {!locked && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="gift-card">{t("Gift card code (optional)")}</Label>
          <div className="flex gap-2">
            <Input
              id="gift-card"
              className="h-11"
              value={giftCardCode}
              onChange={(e) => {
                setGiftCardCode(e.target.value);
                setGiftCardBalance(null);
              }}
              placeholder={t("e.g. 8A7B629E8EEA")}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={!giftCardCode || checkingGiftCard}
              onClick={checkGiftCard}
            >
              {checkingGiftCard ? t("Checking…") : t("Check")}
            </Button>
          </div>
          {giftCardBalance !== null && (
            <p className="text-xs text-success">{t("Balance {formatCurrency} — applying {formatCurrency2}", { formatCurrency: fmt.currency(giftCardBalance), formatCurrency2: fmt.currency(giftCardApplied) })}</p>
          )}
        </div>
      )}

      {billQuery.isError && !bill ? (
        <QueryError
          error={billQuery.error}
          what={t("the bill")}
          onRetry={() => void billQuery.refetch()}
          retrying={billQuery.isFetching}
        />
      ) : (
        <>
          {remainingDue > 0 && (
            <div className="flex flex-col gap-2">
              <Label>{t("Payment method")}</Label>
              <PaymentMethodButtons methods={METHODS} value={method} onChange={setMethod} />
            </div>
          )}

          {remainingDue > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="amount">{method === "CASH" ? t("Cash received") : t("Amount to pay now")}</Label>
              <Input
                id="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className="h-12 text-lg tabular-nums"
                value={amountText}
                placeholder={String(remainingDue)}
                onChange={(e) => setAmountText(e.target.value)}
              />
              {plan.valid && plan.change > 0 && (
                <p className="rounded-lg bg-success/10 px-3 py-2 text-base font-semibold tabular-nums text-success" role="status">{t("Change due {formatCurrency}", { formatCurrency: fmt.currency(plan.change) })}</p>
              )}
              {plan.valid && plan.partial && (
                <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" role="status">{t("Part payment — {formatCurrency} will stay due and the table stays open.", { formatCurrency: fmt.currency(plan.balanceAfter) })}</p>
              )}
              {plan.clamped && (
                <p className="text-xs text-muted-foreground" role="status">{t("{method} can only pay the balance ({formatCurrency}); only that will be charged.", { method: fmt.code(method), formatCurrency: fmt.currency(remainingDue) })}</p>
              )}
            </div>
          )}

          {method === "UPI" && remainingDue > 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-4">
              {upiUri ? (
                <>
                  <QRCodeSVG value={upiUri} size={176} level="M" marginSize={1} />
                  <p className="text-xs font-medium text-[#17251d]">{t("Scan with any UPI app · {formatCurrency} pre-filled", { formatCurrency: fmt.currency(upiAmount) })}</p>
                  <p className="text-[11px] text-neutral-500">{t("Also shown on the customer display")}</p>
                </>
              ) : (
                <p className="text-center text-xs text-neutral-600">
                  {t("No UPI id set yet.")} <Link href="/settings" className="font-medium underline">{t("Add your UPI id in Settings → Restaurant")}</Link> {t("to show a payment QR here.")}
                </p>
              )}
            </div>
          )}

          {remainingDue > 0 && <OnlinePayment orderId={order.id} branchId={branchId} />}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <Label htmlFor="split" className="text-xs text-muted-foreground">
              {t("Split between")}
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
              <span className="text-xs text-muted-foreground">{t("guests")}</span>
            </div>
          </div>
          {split > 1 && bill && (
            <p className="-mt-2 text-center text-xs text-muted-foreground">{t("{formatCurrency} each — enter each guest's share as a part payment, or collect separately and complete payment once for the whole table.", { formatCurrency: fmt.currency(round2(balance / split)) })}</p>
          )}
        </>
      )}

      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <BillSummary bill={bill} giftCardApplied={giftCardApplied} pending={repricing || billQuery.isFetching} />

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!bill}
            onClick={printBill}
            title={t("Prints the bill for the guest. Nothing is charged and the table stays open.")}
          >
            <Printer className="h-4 w-4" />
            {phone ? t("Print / Save PDF") : t("Print bill")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!bill || printUsb.isPending}
            onClick={printBillThermal}
            title={t("Prints the bill on the thermal printer. Nothing is charged and the cash drawer stays shut.")}
          >
            <Printer className="h-4 w-4" />
            {printUsb.isPending ? t("Printing…") : phone ? t("Print bill (Bluetooth)") : t("Print bill (thermal)")}
          </Button>
        </div>

      </div>

      {/* Pinned to the bottom of the scrolling panel on phones, so billing is always one tap away. */}
      <div className="sticky bottom-0 z-10 -mx-1 bg-card px-1 pb-1 pt-2 max-lg:border-t max-lg:border-border max-lg:shadow-[0_-8px_12px_-10px_rgba(0,0,0,0.25)]">
        <Button
          className="h-12 w-full text-base"
          disabled={
            checkout.isPending || !bill || repricing || billQuery.isFetching || !plan.valid
          }
          onClick={handleCheckout}
        >
          {checkout.isPending
            ? t("Processing…")
            : plan.partial
              ? partialLabel
              : plan.change > 0
                ? t("Complete payment · change {formatCurrency}", { formatCurrency: fmt.currency(plan.change) })
                : bill
                  ? t("Complete payment · {formatCurrency}", { formatCurrency: fmt.currency(bill.totalDue) })
                  : t("Complete payment")}
        </Button>
      </div>
      <BillShareDialog
        orderId={shareOrderId ?? ""}
        branchId={branchId}
        adjustments={locked ? {} : settled}
        open={!!shareOrderId}
        onOpenChange={(o) => !o && setShareOrderId(null)}
      />
    </div>
  );
}

// The settlement summary: every figure on the printed bill, in the same order.
function BillSummary({
  bill,
  giftCardApplied,
  pending,
}: {
  bill: BillPreview | undefined;
  giftCardApplied: number;
  pending: boolean;
}) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  if (!bill) {
    return <p className="text-sm text-muted-foreground">{t("Pricing the bill…")}</p>;
  }
  const source = bill.couponCode
    ? t("coupon {couponCode}", { couponCode: bill.couponCode })
    : bill.promotionName
      ? bill.promotionName
      : bill.discountType === "FIXED"
        ? t("flat discount")
        : null;
  return (
    <div className={pending ? "opacity-70" : undefined} aria-busy={pending}>
      <dl className="flex flex-col gap-1 text-sm">
        <Row label={t("Subtotal")} value={fmt.currency(bill.subtotal)} />
        {bill.discountAmount > 0 && (
          <Row
            label={t("Discount{value}", { value: source ? ` (${source})` : "" })}
            value={`− ${discountSummary(bill.discountPercent, bill.discountAmount, fmt.currency, (value) => fmt.percent(value, Number.isInteger(value) ? 0 : 2))}`}
            accent
          />
        )}
        <Row label={t("Tax (included)")} value={fmt.currency(bill.taxAmount)} muted />
        {bill.loyaltyDiscountAmount > 0 && (
          <Row
            label={t("Loyalty ({loyaltyPointsRedeemed} pts)", { loyaltyPointsRedeemed: bill.loyaltyPointsRedeemed })}
            value={`− ${fmt.currency(bill.loyaltyDiscountAmount)}`}
            accent
          />
        )}
        {bill.tipAmount > 0 && <Row label={t("Tip")} value={fmt.currency(bill.tipAmount)} />}
        {bill.deliveryFee > 0 && <Row label={t("Delivery fee")} value={fmt.currency(bill.deliveryFee)} />}
      </dl>
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm font-medium text-foreground">{t("Total due")}</span>
        <span className="text-lg font-semibold tabular-nums text-foreground">{fmt.currency(bill.totalDue)}</span>
      </div>
      {bill.amountPaid > 0 && (
        <dl className="mt-1 flex flex-col gap-1 text-sm">
          <Row label={t("Paid so far")} value={fmt.currency(bill.amountPaid)} />
        </dl>
      )}
      {giftCardApplied > 0 && <Row label={t("Gift card")} value={`− ${fmt.currency(giftCardApplied)}`} accent />}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{t("Balance due")}</span>
        <span className="text-base font-semibold tabular-nums text-foreground">
          {fmt.currency(Math.max(round2(bill.balanceDue - giftCardApplied), 0))}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={muted ? "text-xs text-muted-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className={`tabular-nums ${accent ? "text-success" : muted ? "text-xs text-muted-foreground" : "text-foreground"}`}>
        {value}
      </dd>
    </div>
  );
}
