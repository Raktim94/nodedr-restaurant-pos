"use client";

import { ArrowLeft, CheckCircle2, Printer, RefreshCw, WifiOff } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { KioskMenu } from "@/lib/kiosk-api";
import { basketCount, basketTotal, type BasketLine } from "@/lib/kiosk-basket";
import type { KioskConfirmation, SubmitState } from "@/lib/kiosk-flow";
import { orderQrPayload } from "@/lib/scan";
import { BasketLines } from "./basket-lines";
import { Banner, KButton } from "./kiosk-ui";
import { printTicket } from "./kiosk-print";

export function ReviewScreen({
  menu,
  basket,
  submit,
  locked,
  online,
  fmt,
  header,
  serviceLabel,
  onChange,
  onBack,
  onConfirm,
  onStartOver,
}: {
  menu: KioskMenu;
  basket: BasketLine[];
  submit: SubmitState;
  locked: boolean;
  online: boolean;
  fmt: (n: number) => string;
  header: React.ReactNode;
  serviceLabel: string;
  onChange: (key: string, delta: number) => void;
  onBack: () => void;
  onConfirm: () => void;
  onStartOver: () => void;
}) {
  const { t } = useI18n();
  const pending = submit.status === "pending";
  const failed = submit.status === "error" ? submit.kind : null;
  const ambiguous = failed === "network" || failed === "server";
  const taxText =
    menu.taxMode === "INCLUSIVE"
      ? t("kiosk.review.taxIncluded", { tax: menu.taxLabel })
      : t("kiosk.review.taxAdded", { tax: menu.taxLabel });

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-6 lg:p-6">
        <section className="flex min-h-0 flex-1 flex-col rounded-3xl border-2 border-border bg-card">
          <h1 className="flex items-center justify-between gap-3 border-b border-border p-5 text-[1.9rem] font-bold">
            {t("kiosk.review.title")}
            <span className="rounded-full bg-secondary px-4 py-1 text-[1.1rem] font-semibold">{serviceLabel}</span>
          </h1>
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            <BasketLines lines={basket} fmt={fmt} locked={locked} onChange={onChange} />
          </div>
        </section>

        <section className="flex shrink-0 flex-col justify-between gap-4 rounded-3xl border-2 border-border bg-card p-5 lg:w-[26rem]">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-[2rem] font-bold">
              <span>{t("kiosk.basket.total")}</span>
              <span className="tabular-nums">{fmt(basketTotal(basket))}</span>
            </div>
            <p className="text-[1rem] text-muted-foreground">
              {basketCount(basket) === 1 ? t("kiosk.basket.item") : t("kiosk.basket.items", { count: basketCount(basket) })}
              {" · "}
              {taxText}
            </p>
            <p className="text-[1.05rem] font-medium">{t("kiosk.review.payLater")}</p>
          </div>

          <div className="space-y-3">
            {!online && (
              <Banner tone="error" title={t("kiosk.offline.title")}>
                {t("kiosk.offline.body")}
              </Banner>
            )}
            {failed && (
              <Banner tone="error" title={t(`kiosk.err.${failed}.title`)}>
                {failed === "validation" && submit.status === "error" && submit.message
                  ? `${t("kiosk.err.validation.body")} (${submit.message})`
                  : t(`kiosk.err.${failed}.body`)}
              </Banner>
            )}

            <KButton
              large
              className="w-full"
              loading={pending}
              disabled={!online || basket.length === 0}
              onClick={onConfirm}
            >
              {pending ? (
                t("kiosk.review.sending")
              ) : ambiguous ? (
                <>
                  <RefreshCw className="h-6 w-6" aria-hidden />
                  {t("kiosk.review.retry")}
                </>
              ) : (
                t("kiosk.review.confirm")
              )}
            </KButton>
            {ambiguous ? (
              <KButton variant="secondary" className="w-full" disabled={pending} onClick={onStartOver}>
                {t("kiosk.review.startOver")}
              </KButton>
            ) : (
              <KButton variant="secondary" className="w-full" disabled={pending} onClick={onBack}>
                <ArrowLeft className="h-5 w-5" aria-hidden />
                {t("kiosk.review.back")}
              </KButton>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function DoneScreen({
  menu,
  confirmation,
  secondsLeft,
  fmt,
  localeTag,
  online,
  onNewOrder,
}: {
  menu: KioskMenu;
  confirmation: KioskConfirmation;
  secondsLeft: number;
  fmt: (n: number | string) => string;
  localeTag: string;
  online: boolean;
  onNewOrder: () => void;
}) {
  const { t } = useI18n();
  const qrRef = useRef<HTMLDivElement>(null);
  const [printState, setPrintState] = useState<"idle" | "printing" | "unavailable">("idle");

  const print = async () => {
    setPrintState("printing");
    const ok = await printTicket({
      restaurantName: menu.restaurantName,
      orderNumber: confirmation.orderNumber,
      createdAt: confirmation.createdAt,
      serviceLabel:
        confirmation.serviceType === "DINE_IN" ? t("kiosk.service.dineIn") : t("kiosk.service.takeaway"),
      items: confirmation.items,
      subtotal: confirmation.subtotal,
      taxAmount: confirmation.taxAmount,
      totalAmount: confirmation.totalAmount,
      taxLabel: menu.taxLabel,
      taxMode: menu.taxMode,
      locale: localeTag,
      currency: confirmation.currency,
      qrSvg: qrRef.current?.innerHTML,
      labels: {
        order: t("kiosk.ticket.order"),
        total: t("kiosk.ticket.total"),
        taxIncluded: t("kiosk.ticket.taxIncluded"),
        notPaid: t("kiosk.ticket.notPaid"),
        payAtCounter: t("kiosk.ticket.payAtCounter"),
      },
    });
    setPrintState(ok ? "idle" : "unavailable");
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto px-8 py-6 text-center">
      <CheckCircle2 className="h-24 w-24 text-success" aria-hidden />
      <h1 className="text-[3rem] font-bold">{t("kiosk.done.title")}</h1>
      <div role="status" aria-live="polite">
        <p className="text-[1.5rem] text-muted-foreground">{t("kiosk.done.number")}</p>
        <p data-testid="order-number" className="text-[5.5rem] font-extrabold leading-none tracking-wide text-primary tabular-nums">
          {confirmation.orderNumber.split("-").pop()}
        </p>
        <p className="mt-1 text-[1rem] text-muted-foreground tabular-nums">{confirmation.orderNumber}</p>
      </div>
      <p className="text-[1.5rem] font-semibold">{t("kiosk.done.pay")}</p>
      <p className="text-[1.25rem] tabular-nums">
        {t("kiosk.basket.total")}: <strong>{fmt(confirmation.totalAmount)}</strong>
      </p>

      {printState === "unavailable" && (
        <div className="w-full max-w-[40rem]">
          <Banner tone="warning" title={t("kiosk.done.printUnavailable")} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-4">
        <KButton variant="secondary" large loading={printState === "printing"} onClick={print}>
          <Printer className="h-6 w-6" aria-hidden />
          {t("kiosk.done.print")}
        </KButton>
        <KButton large onClick={onNewOrder}>
          {t("kiosk.done.newOrder")}
        </KButton>
      </div>
      <p className="text-[1.1rem] text-muted-foreground tabular-nums" aria-live="off">
        {t("kiosk.done.autoReturn", { seconds: secondsLeft })}
      </p>
      {!online && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <WifiOff className="h-5 w-5" aria-hidden /> {t("kiosk.offline.title")}
        </div>
      )}

      {/* Source for the ticket's order QR (read by staff scanners). Not shown. */}
      <div ref={qrRef} className="hidden" aria-hidden>
        <QRCodeSVG value={orderQrPayload(confirmation.orderNumber)} size={160} marginSize={1} />
      </div>
    </div>
  );
}
