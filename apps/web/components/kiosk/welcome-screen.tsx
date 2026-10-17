"use client";

import { RefreshCw, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import type { KioskMenu } from "@/lib/kiosk-api";
import type { ServiceType } from "@/lib/kiosk-flow";
import { Banner, KButton } from "./kiosk-ui";

export type MenuLoad =
  | { status: "loading" }
  | { status: "ready"; menu: KioskMenu }
  | { status: "empty"; menu: KioskMenu }
  | { status: "unreachable" }
  | { status: "notFound" };

export function WelcomeScreen({
  load,
  onRetry,
  onStart,
}: {
  load: MenuLoad;
  onRetry: () => void;
  onStart: () => void;
}) {
  const { t } = useI18n();
  const menu = load.status === "ready" || load.status === "empty" ? load.menu : null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
      {menu?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={menu.logoUrl} alt="" className="h-28 w-28 rounded-3xl object-contain" />
      ) : (
        <UtensilsCrossed className="h-20 w-20 text-primary" aria-hidden />
      )}
      <div>
        <h1 className="text-[3rem] font-bold leading-tight tracking-tight">
          {menu?.restaurantName ?? " "}
        </h1>
        <p className="mt-2 text-[1.75rem] text-muted-foreground">{t("kiosk.welcome.title")}</p>
      </div>

      {load.status === "ready" && (
        <KButton large onClick={onStart} className="min-w-[22rem] text-[1.75rem]">
          {t("kiosk.welcome.touch")}
        </KButton>
      )}
      {load.status === "loading" && (
        <div role="status" aria-label="loading" className="h-[4rem] w-[22rem] animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none" />
      )}
      {load.status === "empty" && (
        <div className="w-full max-w-[40rem]">
          <Banner tone="warning" title={t("kiosk.menu.empty.title")} action={<RetryButton onRetry={onRetry} />}>
            {t("kiosk.menu.empty.body")}
          </Banner>
        </div>
      )}
      {load.status === "unreachable" && (
        <div className="w-full max-w-[40rem]">
          <Banner tone="error" title={t("kiosk.load.error.title")} action={<RetryButton onRetry={onRetry} />}>
            {t("kiosk.load.error.body")}
          </Banner>
        </div>
      )}
      {load.status === "notFound" && (
        <div className="w-full max-w-[40rem]">
          <Banner tone="error" title={t("kiosk.load.notFound.title")}>
            {t("kiosk.load.notFound.body")}
          </Banner>
        </div>
      )}
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <KButton variant="secondary" onClick={onRetry}>
      <RefreshCw className="h-5 w-5" aria-hidden />
      {t("kiosk.load.retry")}
    </KButton>
  );
}

export function ServiceScreen({
  services,
  onChoose,
}: {
  services: { dineIn: boolean; takeaway: boolean };
  onChoose: (s: ServiceType) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 px-8 text-center">
      <h1 className="text-[2.75rem] font-bold">{t("kiosk.service.title")}</h1>
      <div className="flex w-full max-w-[56rem] flex-col gap-6 sm:flex-row">
        {services.dineIn && (
          <ServiceTile icon={<UtensilsCrossed className="h-16 w-16" aria-hidden />} label={t("kiosk.service.dineIn")} onClick={() => onChoose("DINE_IN")} />
        )}
        {services.takeaway && (
          <ServiceTile icon={<ShoppingBag className="h-16 w-16" aria-hidden />} label={t("kiosk.service.takeaway")} onClick={() => onChoose("TAKEAWAY")} />
        )}
      </div>
    </div>
  );
}

function ServiceTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[14rem] flex-1 touch-manipulation select-none flex-col items-center justify-center gap-4 rounded-3xl border-4 border-border bg-card text-[2rem] font-bold text-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-[0.98] motion-reduce:transition-none"
    >
      <span className="text-primary">{icon}</span>
      {label}
    </button>
  );
}
