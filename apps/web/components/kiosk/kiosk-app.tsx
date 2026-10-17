"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { formatCurrency } from "@/lib/format";
import { KioskApiError, kioskApi } from "@/lib/kiosk-api";
import { toOrderItems } from "@/lib/kiosk-basket";
import { initialKioskState, isBasketLocked, kioskReducer } from "@/lib/kiosk-flow";
import { uuid } from "@/lib/uuid";
import { KButton } from "./kiosk-ui";
import { Banner } from "./kiosk-ui";
import { MenuScreen } from "./menu-screen";
import { DoneScreen, ReviewScreen } from "./review-screen";
import { useIdle, useKioskServiceWorker, useOnline, useScreenAwake } from "./use-kiosk-device";
import { ServiceScreen, WelcomeScreen, type MenuLoad } from "./welcome-screen";
import { LOCALES_SHOWN, KioskHeader } from "./kiosk-header";

const IDLE_MS = 60_000;
const IDLE_WARN_SECONDS = 15;
const DONE_VISIBLE_SECONDS = 25;
const MENU_RETRY_MS = 10_000;

export function KioskApp({ token }: { token: string }) {
  const { t, locale, setLocale } = useI18n();
  const [state, dispatch] = useReducer(kioskReducer, initialKioskState);
  const online = useOnline();
  const keepAwake = useScreenAwake();
  useKioskServiceWorker();

  const menuQuery = useQuery({
    queryKey: ["kiosk-menu", token],
    queryFn: () => kioskApi.menu(token),
    retry: false,
    staleTime: 30_000,
    // Polls only while the server can't be reached, and gently.
    refetchInterval: (q) =>
      q.state.status === "error" && (q.state.error as KioskApiError)?.kind !== "notFound"
        ? MENU_RETRY_MS
        : false,
  });

  const menu = menuQuery.data;
  const load: MenuLoad = menu
    ? menu.categories.length > 0
      ? { status: "ready", menu }
      : { status: "empty", menu }
    : menuQuery.isError
      ? (menuQuery.error as KioskApiError).kind === "notFound"
        ? { status: "notFound" }
        : { status: "unreachable" }
      : { status: "loading" };

  const localeTag = locale === "es" ? "es-ES" : "en-GB";
  const fmt = useCallback(
    (n: number | string) => formatCurrency(n, menu?.currency ?? "EUR", localeTag),
    [menu?.currency, localeTag],
  );

  // ---- submit ------------------------------------------------------------
  const inFlight = useRef(false);
  const submit = async () => {
    if (!menu || !state.serviceType || inFlight.current || state.submit.status === "pending") return;
    inFlight.current = true;
    const fresh = uuid();
    const requestId = state.requestId ?? fresh; // retry => identical key
    dispatch({ type: "SUBMIT_START", newRequestId: fresh });
    try {
      const result = await kioskApi.order(token, {
        requestId,
        serviceType: state.serviceType,
        items: toOrderItems(state.basket),
      });
      dispatch({ type: "SUBMIT_OK", confirmation: result });
    } catch (err) {
      const e = err instanceof KioskApiError ? err : new KioskApiError("network", "No connection");
      if (e.kind === "unavailable") {
        const names = state.basket
          .filter((l) => e.unavailableItemIds.includes(l.menuItemId))
          .map((l) => l.name);
        dispatch({ type: "ITEMS_UNAVAILABLE", ids: e.unavailableItemIds, names: [...new Set(names)] });
        void menuQuery.refetch();
      } else if (e.kind === "network") dispatch({ type: "SUBMIT_FAIL", kind: "network" });
      else if (e.kind === "server") dispatch({ type: "SUBMIT_FAIL", kind: "server" });
      else if (e.kind === "rate") dispatch({ type: "SUBMIT_FAIL", kind: "rate" });
      else dispatch({ type: "SUBMIT_FAIL", kind: "validation", message: e.message });
    } finally {
      inFlight.current = false;
    }
  };

  // ---- reset / idle ------------------------------------------------------
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [idleWarn, setIdleWarn] = useState<number | null>(null);
  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    setIdleWarn(null);
    setConfirmCancel(false);
    setLocale("es");
    void menuQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLocale]);

  const interacting =
    state.step === "service" || state.step === "menu" || state.step === "review";
  useIdle(interacting && state.submit.status !== "pending" && idleWarn === null, IDLE_MS, () =>
    setIdleWarn(IDLE_WARN_SECONDS),
  );
  useEffect(() => {
    if (idleWarn === null) return;
    if (idleWarn <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reset();
      return;
    }
    const id = setTimeout(() => setIdleWarn((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [idleWarn, reset]);

  // Confirmation stays on screen for a fixed time before the clean start screen.
  const [doneLeft, setDoneLeft] = useState(DONE_VISIBLE_SECONDS);
  useEffect(() => {
    if (state.step !== "done") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoneLeft(DONE_VISIBLE_SECONDS);
    const id = setInterval(() => setDoneLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [state.step]);
  useEffect(() => {
    if (state.step === "done" && doneLeft <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reset();
    }
  }, [state.step, doneLeft, reset]);

  const askCancel = () => (state.basket.length > 0 ? setConfirmCancel(true) : reset());

  const header = (
    <KioskHeader
      name={menu?.restaurantName ?? ""}
      locale={locale}
      onLocale={setLocale}
      locales={LOCALES_SHOWN}
      onCancel={askCancel}
      cancelLabel={t("kiosk.cancel")}
      languageLabel={t("kiosk.language")}
      serviceLabel={
        state.serviceType
          ? state.serviceType === "DINE_IN"
            ? t("kiosk.service.dineIn")
            : t("kiosk.service.takeaway")
          : null
      }
      onChangeService={
        state.step === "menu" && menu?.services.dineIn && menu.services.takeaway && state.basket.length === 0
          ? () => dispatch({ type: "GOTO", step: "service" })
          : undefined
      }
      changeLabel={t("kiosk.review.change")}
    />
  );

  const serviceLabel =
    state.serviceType === "DINE_IN" ? t("kiosk.service.dineIn") : t("kiosk.service.takeaway");

  let screen: React.ReactNode;
  if (state.step === "welcome" || !menu) {
    screen = (
      <WelcomeScreen
        load={load}
        onRetry={() => void menuQuery.refetch()}
        onStart={() => {
          // A real tap: the only moment the browser lets us keep the screen on / go full-screen.
          keepAwake();
          if (!document.fullscreenElement) {
            void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
          }
          dispatch({ type: "START", services: menu?.services ?? { dineIn: true, takeaway: true } });
        }}
      />
    );
  } else if (state.step === "service") {
    screen = (
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1">
          <ServiceScreen
            services={menu.services}
            onChoose={(serviceType) => dispatch({ type: "CHOOSE_SERVICE", serviceType })}
          />
        </div>
      </div>
    );
  } else if (state.step === "menu") {
    screen = (
      <MenuScreen
        menu={menu}
        basket={state.basket}
        unavailableNames={state.unavailableNames}
        fmt={fmt}
        header={header}
        onAdd={(line) => dispatch({ type: "ADD", line })}
        onChange={(key, delta) => dispatch({ type: "CHANGE_QTY", key, delta })}
        onReview={() => dispatch({ type: "GOTO", step: "review" })}
      />
    );
  } else if (state.step === "review") {
    screen = (
      <ReviewScreen
        menu={menu}
        basket={state.basket}
        submit={state.submit}
        locked={isBasketLocked(state)}
        online={online}
        fmt={fmt}
        header={header}
        serviceLabel={serviceLabel}
        onChange={(key, delta) => dispatch({ type: "CHANGE_QTY", key, delta })}
        onBack={() => dispatch({ type: "GOTO", step: "menu" })}
        onConfirm={() => void submit()}
        onStartOver={reset}
      />
    );
  } else if (state.confirmation) {
    screen = (
      <DoneScreen
        menu={menu}
        confirmation={state.confirmation}
        secondsLeft={Math.max(doneLeft, 0)}
        fmt={fmt}
        localeTag={localeTag}
        online={online}
        onNewOrder={reset}
      />
    );
  }

  return (
    <div
      className="relative h-full select-none"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {!online && state.step !== "review" && (
        <div className="absolute inset-x-0 top-0 z-20 p-3">
          <Banner tone="error" title={t("kiosk.offline.title")}>
            {t("kiosk.offline.body")}
          </Banner>
        </div>
      )}
      {screen}

      {confirmCancel && (
        <Overlay>
          <p className="text-[1.75rem] font-bold">{t("kiosk.cancel.confirm")}</p>
          <div className="flex gap-3">
            <KButton variant="secondary" large className="flex-1" onClick={() => setConfirmCancel(false)}>
              {t("kiosk.review.back")}
            </KButton>
            <KButton variant="danger" large className="flex-1" onClick={reset}>
              {t("kiosk.cancel")}
            </KButton>
          </div>
        </Overlay>
      )}
      {idleWarn !== null && (
        <Overlay>
          <p className="text-[2rem] font-bold">{t("kiosk.idle.title")}</p>
          <p className="text-[1.35rem] text-muted-foreground tabular-nums" aria-live="polite">
            {t("kiosk.idle.body", { seconds: Math.max(idleWarn, 0) })}
          </p>
          <KButton large onClick={() => setIdleWarn(null)}>
            {t("kiosk.idle.continue")}
          </KButton>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div role="alertdialog" aria-modal="true" className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div className="flex w-full max-w-[40rem] flex-col gap-5 rounded-3xl bg-card p-8 text-center shadow-2xl">
        {children}
      </div>
    </div>
  );
}
