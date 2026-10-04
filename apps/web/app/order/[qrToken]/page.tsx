"use client";

import { BellRing, CheckCircle2, Leaf, Minus, Plus, Receipt, UtensilsCrossed } from "lucide-react";
import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ModifierPickerDialog } from "@/components/pos/modifier-picker-dialog";
import { PopBurst } from "@/components/order/pop-burst";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/context";
import { api, ApiError } from "@/lib/api";
import { playSuccessChime, vibrateSuccess } from "@/lib/celebrate";
import { formatCurrency } from "@/lib/format";

interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
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
    orderNumber: string;
    status: string;
    acceptance: string;
    items: { id: string; nameSnapshot: string; quantity: number; status: string }[];
  } | null;
  openRequests: ("WAITER" | "BILL")[];
}

const ITEM_STATUS_LABEL: Record<string, string> = {
  NEW: "Received",
  ACCEPTED: "Received",
  PREPARING: "Being prepared",
  READY: "Ready",
  SERVED: "Served",
  CANCELLED: "Cancelled",
};

interface PublicMenuCategory {
  id: string;
  name: string;
  items: PublicMenuItem[];
}

interface PublicMenuResponse {
  branchName: string;
  tableName: string;
  categories: PublicMenuCategory[];
}

export default function PublicMenuPage({
  params,
}: {
  params: Promise<{ qrToken: string }>;
}) {
  const { qrToken } = use(params);
  const { t } = useI18n();
  const nameStorageKey = `qr-guest-name:${qrToken}`;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickerItem, setPickerItem] = useState<PublicMenuItem | null>(null);
  const queryClient = useQueryClient();
  const [placed, setPlaced] = useState<{ orderNumber: string } | null>(null);
  const [guestName, setGuestName] = useState("");
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
    const saved = sessionStorage.getItem(nameStorageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setGuestName(saved);
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
  });

  // Live status of the table's tab and any pending waiter/bill request.
  const { data: status } = useQuery({
    queryKey: ["public-status", qrToken],
    queryFn: () => api.get<PublicStatus>(`/public/menu/${qrToken}/status`),
    refetchInterval: 8000,
    enabled: !!data,
  });

  const requestService = useMutation({
    mutationFn: (type: "WAITER" | "BILL") => api.post(`/public/menu/${qrToken}/request`, { type }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["public-status", qrToken] }),
  });

  const placeOrder = useMutation({
    mutationFn: () =>
      api.post<{ orderNumber: string }>(`/public/menu/${qrToken}/order`, {
        guestName,
        items: cart.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          modifierIds: l.modifierIds,
        })),
      }),
    onSuccess: (order) => {
      setPlaced(order);
      setCart([]);
      queryClient.invalidateQueries({ queryKey: ["public-status", qrToken] });
    },
  });

  const confirmName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    sessionStorage.setItem(nameStorageKey, trimmed);
    setGuestName(trimmed);
  };

  const cartCount = cart.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const quantityOfItem = (itemId: string) =>
    cart.filter((l) => l.menuItemId === itemId).reduce((sum, l) => sum + l.quantity, 0);

  const addLine = (item: PublicMenuItem, modifierIds: string[], label: string, extra: number) => {
    const key = `${item.id}:${[...modifierIds].sort().join(",")}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...prev,
        { key, menuItemId: item.id, modifierIds, label, unitPrice: Number(item.price) + extra, quantity: 1 },
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

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <UtensilsCrossed className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">{t("order.qrNotRecognized")}</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : t("order.askStaffForHelp")}
        </p>
      </div>
    );
  }

  if (placed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
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
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
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
    <div className="relative min-h-screen bg-background pb-24">
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
                            {item.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            )}
                            <span className="mt-1 block text-sm font-medium tabular-nums text-foreground">
                              {formatCurrency(item.price)}
                            </span>
                          </div>
                        </div>
                        {quantity > 0 ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeOne(item.id)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-5 text-center text-sm tabular-nums">{quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleAdd(item)}
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

      {status && (status.order || status.openRequests.length > 0 || data) && (
        <section className="mx-auto max-w-lg px-5 pb-6">
          {status.order && (
            <div className="mb-4 rounded-2xl border border-border p-4">
              <p className="text-sm font-medium text-foreground">
                Your order #{status.order.orderNumber}
                {status.order.acceptance === "PENDING" && " — waiting for the restaurant to confirm"}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
                {status.order.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>
                      {i.quantity} × {i.nameSnapshot}
                    </span>
                    <span>{ITEM_STATUS_LABEL[i.status] ?? i.status}</span>
                  </li>
                ))}
              </ul>
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
              {status.openRequests.includes("WAITER") ? "Waiter is coming" : "Call waiter"}
            </Button>
            {status.order && (
              <Button
                variant="outline"
                className="h-11 flex-1"
                disabled={requestService.isPending || status.openRequests.includes("BILL")}
                onClick={() => requestService.mutate("BILL")}
              >
                <Receipt className="mr-2 h-4 w-4" />
                {status.openRequests.includes("BILL") ? "Bill requested" : "Request bill"}
              </Button>
            )}
          </div>
        </section>
      )}

      <ModifierPickerDialog
        item={pickerItem}
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
        {t("order.pricesIncludeTax")}
      </footer>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <Button
              className="h-12 flex-1"
              disabled={placeOrder.isPending}
              onClick={() => placeOrder.mutate()}
            >
              {placeOrder.isPending
                ? t("order.placingOrder")
                : `${t("order.placeOrder")} — ${cartCount} ${cartCount > 1 ? t("order.items") : t("order.item")} · ${formatCurrency(cartTotal)}`}
            </Button>
          </div>
          {placeOrder.isError && (
            <p className="mx-auto mt-2 max-w-lg text-center text-xs text-destructive">
              {placeOrder.error instanceof ApiError
                ? placeOrder.error.message
                : t("order.couldNotPlace")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
