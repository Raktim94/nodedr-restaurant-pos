"use client";

import { BellRing, CheckCircle2, Leaf, Minus, Plus, Receipt, UtensilsCrossed } from "lucide-react";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { PauseBadge } from "@/components/menu/pause-badge";
import { useMenuPauseLabels } from "@/hooks/use-menu-pauses";
import { withReportedMenuPauses } from "@/lib/menu-pauses";
import { RatingCard } from "@/components/order/rating-card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ModifierPickerDialog } from "@/components/pos/modifier-picker-dialog";
import { PopBurst } from "@/components/order/pop-burst";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_TAGS } from "@/lib/i18n/locales";
import { api, ApiError } from "@/lib/api";
import { playSuccessChime, vibrateSuccess } from "@/lib/celebrate";
import { formatCurrency } from "@/lib/format";
import { toInclusivePrice } from "@/lib/pricing-preview";
import { uuid } from "@/lib/uuid";

interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
  taxRatePercent: string;
  pausedUntil: string | null;
  isVeg: boolean;
  modifierGroups: {
    modifierGroup: {
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
      isRequired: boolean;
      modifiers: { id: string; name: string; priceAdjustment: string; isDefault: boolean }[];
    };
  }[];
}

// One cart line = an item plus its chosen options; the same item with
// different options is a separate line.
interface CartLine {
  key: string;
  menuItemId: string;
  modifierIds: string[];
  label: string;
  unitPrice: number;
  quantity: number;
}

interface PublicStatus {
  order: {
    id: string;
    orderNumber?: string;
    status: string;
    acceptance?: string;
    paid: boolean;
    payIntent?: "CASH" | "ONLINE" | null;
    heldForPayment?: boolean;
    kitchen: "WAITING_PAYMENT" | "SENT" | "NEW" | "PREPARING" | "READY" | "SERVED";
    lastPayment?: "CREATED" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "NEEDS_REVIEW" | null;
    paged: boolean;
    items?: { id: string; nameSnapshot: string; quantity: number; status: string }[];
  } | null;
  openRequests: ("WAITER" | "BILL")[];
}

const ITEM_STATUS_LABEL: Record<string, string> = {
  NEW: "order.received",
  ACCEPTED: "order.received",
  PREPARING: "order.preparing",
  READY: "order.ready",
  SERVED: "order.served",
  CANCELLED: "order.cancelled",
};

interface PublicMenuCategory {
  id: string;
  name: string;
  items: PublicMenuItem[];
}

interface PublicMenuResponse {
  branchName: string;
  timezone: string;
  currency: string;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  tableName: string;
  categories: PublicMenuCategory[];
  payments?: { cash: boolean; online: boolean };
  session?: { required: boolean };
}

export default function PublicMenuPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { qrToken } = use(params);
  const { t, locale } = useI18n();
  const nameStorageKey = `qr-guest-name:${qrToken}`;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickerItem, setPickerItem] = useState<PublicMenuItem | null>(null);
  const queryClient = useQueryClient();
  const [placed, setPlaced] = useState<{ orderNumber: string } | null>(null);
  const [guestName, setGuestName] = useState("");
  const [payChoice, setPayChoice] = useState<"CASH" | "ONLINE">("CASH");
  const [payError, setPayError] = useState<string | null>(null);
  // One key per basket + payment choice, kept across retries so a double tap or a dropped connection cannot make a second order.
  const attempt = useRef<{ sig: string; key: string } | null>(null);
  // The table code the staff gave the guest is traded for a grant kept only in this tab. Old or copied QR photos have none.
  const sKey = `table-session:${qrToken}`;
  const [grant, setGrant] = useState<string | null>(null);
  // A verified tag tap (see /t/[ref]) is a short-lived proof of being at THIS table. The first order opens the table and the
  // server then hands back a normal session grant, which replaces it.
  const aKey = `table-access:${qrToken}`;
  const [access, setAccess] = useState<string | null>(null);
  const grantRef = useRef<string | null>(null); // the newest grant, readable in the same tick it arrives (payment starts right after the order)
  const [codeDraft, setCodeDraft] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const hdr = (): RequestInit => {
    const g = grantRef.current ?? grant;
    const headers: Record<string, string> = {};
    if (g) headers["X-Table-Session"] = g;
    if (access) headers["X-Table-Access"] = access;
    return Object.keys(headers).length ? { headers } : {};
  };
  const lostSession = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : undefined;
    if (code === "TABLE_SESSION_REQUIRED" || code === "TABLE_SESSION_EXPIRED") {
      try { sessionStorage.removeItem(sKey); sessionStorage.removeItem(aKey); } catch { /* storage blocked */ }
      grantRef.current = null;
      setGrant(null);
      setAccess(null);
      setSessionMsg(e instanceof ApiError ? e.message : "order.sessionEnded");
      return true;
    }
    return false;
  };
  const joinTable = async () => {
    setJoining(true);
    setCodeError(null);
    try {
      const r = await api.post<{ token: string }>(`/public/menu/${qrToken}/session`, { code: codeDraft });
      try { sessionStorage.setItem(sKey, r.token); } catch { /* storage blocked: the grant lives in memory only */ }
      grantRef.current = r.token;
      setGrant(r.token);
      setSessionMsg(null);
      setCodeDraft("");
    } catch (e) {
      setCodeError(e instanceof ApiError ? e.message : "order.invalidCode");
    }
    setJoining(false);
  };
  // A phone that scanned the rotating QR on the table screen arrives with ?j=<short-lived token>: trade it for this
  // phone's own grant, then take the token out of the address bar so it is not bookmarked or shared.
  const joinToken = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("j");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!joinToken) return;
    let alive = true;
    (async () => {
      try {
        const r = await api.post<{ token: string }>(`/public/menu/${qrToken}/session`, { joinToken });
        if (!alive) return;
        try { sessionStorage.setItem(sKey, r.token); } catch { /* storage blocked */ }
        grantRef.current = r.token;
        setGrant(r.token);
        setSessionMsg(null);
      } catch (e) {
        if (alive) setScanMsg(e instanceof ApiError ? e.message : "order.joinFailed");
      }
      try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [nameDraft, setNameDraft] = useState("");

  // Read any name saved earlier this session after mount, not in the state
  // initializer — sessionStorage isn't available during server rendering,
  // so reading it there would make the client's first render disagree with
  // the server-rendered HTML. This is the legitimate exception the
  // set-state-in-effect rule carves out for genuine external-system reads
  // (a browser storage API unavailable until after hydration), not the
  // derive-state-from-already-available-data anti-pattern it otherwise
  // flags.
  useEffect(() => {
    try {
      const g = sessionStorage.getItem(sKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (g) { grantRef.current = g; setGrant(g); }
      const a = sessionStorage.getItem(aKey);
      if (a) setAccess(a);
    } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(nameStorageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setGuestName(saved);
    } catch {
      // Storage can be blocked (private mode / embedded webview); the menu
      // still works with in-memory state only.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (placed) {
      vibrateSuccess();
      playSuccessChime();
    }
  }, [placed]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-menu", qrToken],
    queryFn: () => api.get<PublicMenuResponse>(`/public/menu/${qrToken}`),
    retry: false,
    refetchInterval: (query) => query.state.data && !placed ? 15_000 : false,
  });
  const menuItems = useMemo(() => data?.categories.flatMap((category) => category.items), [data]);
  const pauseLabels = useMenuPauseLabels(menuItems, data?.timezone);
  const hasPaused = cart.some((line) => pauseLabels.has(line.menuItemId));
  const formatPrice = (amount: number | string) => formatCurrency(amount, data?.currency, LOCALE_TAGS[locale]);
  const displayPrice = (item: PublicMenuItem, extra = 0) =>
    toInclusivePrice(
      Number(item.price) + extra,
      Number(item.taxRatePercent ?? 0),
      data?.taxMode ?? "INCLUSIVE",
    );

  // Live status of the table's tab and any pending waiter/bill request.
  const { data: status } = useQuery({
    queryKey: ["public-status", qrToken, grant],
    queryFn: () => api.get<PublicStatus>(`/public/menu/${qrToken}/status`,
      grant ? { headers: { "X-Table-Session": grant } } : undefined),
    refetchInterval: 8000,
    enabled: !!data,
  });

  const requestService = useMutation({
    mutationFn: (type: "WAITER" | "BILL") => api.post(`/public/menu/${qrToken}/request`, { type }, hdr()),
    onError: (e) => { lostSession(e); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["public-status", qrToken] }),
  });

  const startOnlinePayment = async (orderId: string) => {
    setPayError(null);
    try {
      const pay = await api.post<{ checkoutUrl: string | null }>(`/public/menu/${qrToken}/orders/${orderId}/pay-online`, { origin: window.location.origin }, hdr());
      if (!pay.checkoutUrl) throw new Error("no link");
      window.location.href = pay.checkoutUrl;
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : "order.paymentPageFailed");
      void queryClient.invalidateQueries({ queryKey: ["public-status", qrToken] });
    }
  };

  const payAtRegister = useMutation({
    mutationFn: (orderId: string) => api.post(`/public/menu/${qrToken}/orders/${orderId}/pay-cash`, undefined, hdr()),
    onSuccess: () => { setPayError(null); void queryClient.invalidateQueries({ queryKey: ["public-status", qrToken] }); },
    onError: (e) => setPayError(e instanceof ApiError ? e.message : "order.changeFailed"),
  });

  const items = cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, modifierIds: l.modifierIds }));
  const orderRequest = { items, payment: payChoice, guestName };
  const placeOrder = useMutation({
    mutationFn: (body: typeof orderRequest) => {
      const sig = JSON.stringify(body);
      if (!attempt.current || attempt.current.sig !== sig) attempt.current = { sig, key: uuid() };
      return api.post<{ id: string; orderNumber: string; ratingToken?: string; sessionGrant?: string }>(`/public/menu/${qrToken}/order`, { ...body, idempotencyKey: attempt.current.key }, hdr());
    },
    onError: (e) => {
      lostSession(e);
      if (e instanceof ApiError && e.code === "ITEM_UNAVAILABLE") {
        queryClient.setQueryData<PublicMenuResponse>(["public-menu", qrToken], (current) => withReportedMenuPauses(current, e.pausedItems));
        void queryClient.invalidateQueries({ queryKey: ["public-menu", qrToken] });
      }
    },
    onSuccess: async (order, request) => {
      attempt.current = null;
      if (order.sessionGrant) {
        // The order opened (or joined) the table: from now on this phone holds an ordinary session grant.
        try { sessionStorage.setItem(sKey, order.sessionGrant); sessionStorage.removeItem(aKey); } catch { /* storage blocked */ }
        grantRef.current = order.sessionGrant;
        setGrant(order.sessionGrant);
        setAccess(null);
      }
      try { if ((order as { ratingToken?: string }).ratingToken) localStorage.setItem(`rating-token:${order.id}`, (order as { ratingToken?: string }).ratingToken!); } catch { /* storage blocked */ }
      setPlaced(order);
      setCart([]);
      queryClient.invalidateQueries({ queryKey: ["public-status", qrToken] });
      if (request.payment === "ONLINE") await startOnlinePayment(order.id);
    },
  });
  // The previous attempt may already be on the table's tab. Retrying the same
  // basket and payment choice recovers its receipt with the same idempotency key.
  const retryUnknownOrder = placeOrder.isError && JSON.stringify(placeOrder.variables) === JSON.stringify(orderRequest) &&
    (!(placeOrder.error instanceof ApiError) || placeOrder.error.status >= 500);
  const blockedByPause = hasPaused && !retryUnknownOrder;

  const confirmName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    try {
      sessionStorage.setItem(nameStorageKey, trimmed);
    } catch {
      // Keep the name for this visit even when persistence is unavailable.
    }
    setGuestName(trimmed);
  };

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const quantityOfItem = (itemId: string) =>
    cart.filter((l) => l.menuItemId === itemId).reduce((sum, l) => sum + l.quantity, 0);

  const addLine = (item: PublicMenuItem, modifierIds: string[], label: string, extra: number) => {
    if (pauseLabels.has(item.id)) return;
    const key = `${item.id}:${[...modifierIds].sort().join(",")}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...prev,
        { key, menuItemId: item.id, modifierIds, label, unitPrice: displayPrice(item, extra), quantity: 1 },
      ];
    });
  };
  const handleAdd = (item: PublicMenuItem) => {
    if (item.modifierGroups.length > 0) setPickerItem(item);
    else addLine(item, [], "", 0);
  };
  const removeOne = (itemId: string) =>
    setCart((prev) => {
      const idx = [...prev].reverse().findIndex((l) => l.menuItemId === itemId);
      if (idx < 0) return prev;
      const at = prev.length - 1 - idx;
      return prev
        .map((l, i) => (i === at ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0);
    });

  if (error && (!data || (error instanceof ApiError && error.status === 404))) {
    return (
      <div lang={LOCALE_TAGS[locale]} className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <UtensilsCrossed className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">{t("order.qrNotRecognized")}</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError && error.status !== 404 ? t(error.message) : t("order.askStaffForHelp")}
        </p>
      </div>
    );
  }

  if (placed) {
    return (
      <div lang={LOCALE_TAGS[locale]} className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <div className="relative flex h-10 w-10 items-center justify-center">
          <PopBurst />
          <CheckCircle2 className="h-10 w-10 text-success" />
        </div>
        <p className="text-lg font-medium text-foreground">
          {t("order.thankYouName", { name: guestName })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("order.thanksMessage", { branch: data?.branchName ?? t("order.theKitchen") })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("order.orderNumberSent", { number: placed.orderNumber })}
        </p>
        <Button variant="outline" className="mt-2" onClick={() => setPlaced(null)}>
          {t("order.orderMore")}
        </Button>
      </div>
    );
  }

  if (!guestName) {
    return (
      <div lang={LOCALE_TAGS[locale]} className="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="absolute right-4 top-4">
          <LanguageSwitcher compact />
        </div>
        <UtensilsCrossed className="h-8 w-8 text-primary" />
        {isLoading ? (
          <Skeleton className="h-7 w-40" />
        ) : (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {data?.branchName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{data?.tableName}</p>
          </div>
        )}
        <form
          className="flex w-full max-w-xs flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            confirmName();
          }}
        >
          <div className="flex flex-col gap-2 text-left">
            <Label htmlFor="guest-name">{t("order.whatsYourName")}</Label>
            <Input
              id="guest-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={t("order.namePlaceholder")}
              autoFocus
              maxLength={60}
            />
          </div>
          <Button type="submit" className="h-11" disabled={!nameDraft.trim()}>
            {t("order.continueToMenu")}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div lang={LOCALE_TAGS[locale]} className="relative min-h-screen bg-background pb-24">
      <header className="border-b border-border px-5 py-6 text-center">
        <div className="absolute right-4 top-4">
          <LanguageSwitcher compact />
        </div>
        {isLoading ? (
          <Skeleton className="mx-auto h-7 w-40" />
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {data?.branchName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{data?.tableName}</p>
          </>
        )}
      </header>

      <main className="mx-auto max-w-lg px-5 py-6">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {data?.categories.map((category) => (
              <section key={category.id} className="flex flex-col gap-3">
                <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                  {category.name}
                </h2>
                <div className="flex flex-col divide-y divide-border">
                  {category.items.map((item) => {
                    const quantity = quantityOfItem(item.id);
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-4 py-3">
                        <div className="flex items-start gap-2">
                          <Leaf
                            className={`mt-1 h-3.5 w-3.5 shrink-0 ${item.isVeg ? "text-success" : "text-destructive"}`}
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">{item.name}</p>
                            <PauseBadge label={pauseLabels.get(item.id)} />
                            {item.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            )}
                            <span className="mt-1 block text-sm font-medium tabular-nums text-foreground">
                              {formatPrice(displayPrice(item))}
                            </span>
                          </div>
                        </div>
                        {quantity > 0 ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t("order.decrease", { name: item.name })}
                              onClick={() => removeOne(item.id)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-5 text-center text-sm tabular-nums">{quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={t("order.increase", { name: item.name })}
                              onClick={() => handleAdd(item)}
                              disabled={pauseLabels.has(item.id)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => handleAdd(item)}
                            disabled={pauseLabels.has(item.id)}
                          >
                            {t("order.add")}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {data?.session?.required && !grant && access && (
        <p className="mx-auto max-w-lg px-5 pt-4 text-sm text-muted-foreground" data-testid="tap-verified">{t("order.verified")}</p>
      )}

      {data?.session?.required && !grant && !access && (
        <section aria-label={t("order.code")} className="mx-auto max-w-lg px-5 pt-4">
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
            <h2 className="text-base font-semibold text-foreground">{t("order.scanTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("order.scanHint")}</p>
            {scanMsg && <p role="alert" className="mt-2 text-sm text-destructive">{t(scanMsg)}</p>}
            {sessionMsg && <p role="alert" className="mt-2 text-sm text-destructive">{t(sessionMsg)}</p>}
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (codeDraft.trim().length >= 6) void joinTable(); }}>
              <label className="sr-only" htmlFor="table-code">{t("order.code")}</label>
              <input id="table-code" value={codeDraft} onChange={(e) => setCodeDraft(e.target.value.toUpperCase())} maxLength={8} autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text" className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-center text-xl font-semibold uppercase tracking-[0.3em]" placeholder="ABC234" />
              <Button type="submit" className="h-12" disabled={joining || codeDraft.trim().length < 6}>{joining ? t("order.checking") : t("order.join")}</Button>
            </form>
            {codeError && <p role="alert" className="mt-2 text-sm text-destructive">{t(codeError)}</p>}
          </div>
        </section>
      )}

      {status && (status.order || status.openRequests.length > 0 || data) && (
        <section className="mx-auto max-w-lg px-5 pb-6">
          {status.order && (
            <div className="mb-4 rounded-2xl border border-border p-4">
              {status.order.orderNumber && <p className="text-sm font-medium text-foreground">
                {t("order.orderNumber", { number: status.order.orderNumber })}
                {status.order.acceptance === "PENDING" && ` — ${t("order.awaitingConfirmation")}`}
              </p>}
              {status.order.paged && (
                <p role="alert" className="mt-2 rounded-xl bg-success/15 px-3 py-2 text-sm font-semibold text-foreground">{t("order.collect")}</p>
              )}
              <p className="mt-2 text-sm text-foreground" data-testid="order-state">
                {status.order.paid
                  ? `${t("order.paid")} `
                  : status.order.payIntent === "CASH"
                    ? `${t("order.cashDue")} `
                    : status.order.heldForPayment
                      ? `${t("order.waitingPayment")} `
                      : ""}
                {t(`order.kitchen.${status.order.kitchen}`)}
              </p>
              {status.order.paid && <div className="mt-3"><RatingCard orderId={status.order.id} /></div>}
              {!status.order.paid && status.order.payIntent === "ONLINE" && (
                <div className="mt-3 flex flex-col gap-2">
                  {(status.order.lastPayment === "FAILED" || status.order.lastPayment === "EXPIRED") && (
                    <p role="alert" className="text-sm text-destructive">{t("order.chargeFailed")}</p>
                  )}
                  {status.order.lastPayment === "NEEDS_REVIEW" && (
                    <p role="alert" className="text-sm text-destructive">{t("order.chargeUnmatched")}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void startOnlinePayment(status.order!.id)}>{status.order.lastPayment === "FAILED" || status.order.lastPayment === "EXPIRED" ? t("order.retryPayment") : t("order.payNow")}</Button>
                    <Button size="sm" variant="outline" disabled={payAtRegister.isPending} onClick={() => payAtRegister.mutate(status.order!.id)}>{t("order.payCounterInstead")}</Button>
                  </div>
                  {payError && <p role="alert" className="text-sm text-destructive">{t(payError)}</p>}
                </div>
              )}
              {status.order.items && <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                {status.order.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>
                      {i.quantity} × {i.nameSnapshot}
                    </span>
                    <span>{Object.hasOwn(ITEM_STATUS_LABEL, i.status) ? t(ITEM_STATUS_LABEL[i.status]) : i.status}</span>
                  </li>
                ))}
              </ul>}
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={requestService.isPending || status.openRequests.includes("WAITER")}
              onClick={() => requestService.mutate("WAITER")}
            >
              <BellRing className="mr-2 h-4 w-4" />
              {status.openRequests.includes("WAITER") ? t("order.waiterComing") : t("order.callWaiter")}
            </Button>
            {status.order && (
              <Button
                variant="outline"
                className="h-11 flex-1"
                disabled={requestService.isPending || status.openRequests.includes("BILL")}
                onClick={() => requestService.mutate("BILL")}
              >
                <Receipt className="mr-2 h-4 w-4" />
                {status.openRequests.includes("BILL") ? t("order.billRequested") : t("order.requestBill")}
              </Button>
            )}
          </div>
        </section>
      )}

      <ModifierPickerDialog
        item={pickerItem}
        pauseLabel={pickerItem ? pauseLabels.get(pickerItem.id) : undefined}
        formatPrice={formatPrice}
        open={!!pickerItem}
        onOpenChange={(open) => !open && setPickerItem(null)}
        onConfirm={(ids, label) => {
          if (!pickerItem) return;
          const extra = ids.reduce((sum, id) => {
            const m = pickerItem.modifierGroups.flatMap((g) => g.modifierGroup.modifiers).find((x) => x.id === id);
            return sum + (m ? Number(m.priceAdjustment) : 0);
          }, 0);
          addLine(pickerItem, ids, label, extra);
        }}
      />

      <footer className="border-t border-border px-5 py-6 text-center text-xs text-muted-foreground">
        {data?.taxMode === "EXCLUSIVE"
          ? t("order.taxAddedAtBill")
          : t("order.pricesIncludeTax")}
      </footer>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          {data?.payments?.online && (
            <fieldset className="mx-auto mb-3 flex max-w-lg gap-2" aria-label={t("order.howPay")}>
              {([["CASH", "order.payCounter"], ["ONLINE", "order.payPhone"]] as const).map(([v, label]) => (
                <label key={v} className={`flex-1 cursor-pointer rounded-xl border px-3 py-2 text-center text-sm ${payChoice === v ? "border-primary bg-primary/10 font-medium" : "border-border"}`}>
                  <input type="radio" name="pay" className="sr-only" checked={payChoice === v} onChange={() => setPayChoice(v)} />
                  {t(label)}
                </label>
              ))}
            </fieldset>
          )}
          {!data?.payments?.online && <p className="mx-auto mb-2 max-w-lg text-center text-xs text-muted-foreground">{t("order.willPayCounter")}</p>}
          {blockedByPause && <p role="status" className="mx-auto mb-2 max-w-lg text-center text-sm text-warning">{t("menu.removePaused")}</p>}
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <Button
              className="h-12 flex-1"
              disabled={blockedByPause || placeOrder.isPending || (!!data?.session?.required && !grant && !access)}
              onClick={() => placeOrder.mutate(orderRequest)}
            >
              {placeOrder.isPending
                ? t("order.placingOrder")
                : `${t("order.placeOrder")} — ${cartCount} ${cartCount > 1 ? t("order.items") : t("order.item")} · ${formatPrice(cartTotal)}`}
            </Button>
          </div>
          {placeOrder.isError && !(placeOrder.error instanceof ApiError && placeOrder.error.pausedItems.length && blockedByPause) && (
            <p className="mx-auto mt-2 max-w-lg text-center text-xs text-destructive">
              {placeOrder.error instanceof ApiError
                ? t(placeOrder.error.message)
                : t("order.couldNotPlace")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
