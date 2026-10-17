"use client";

import { Plus, Search, ShoppingBag, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { KioskMenu, KioskMenuItem } from "@/lib/kiosk-api";
import { basketCount, basketTotal, toInclusiveUnitPrice, type BasketLine } from "@/lib/kiosk-basket";
import { cn } from "@/lib/utils";
import { BasketLines } from "./basket-lines";
import { Banner, KButton, TOUCH } from "./kiosk-ui";
import { ModifierSheet, type ModifierChoice } from "./modifier-sheet";

export function MenuScreen({
  menu,
  basket,
  unavailableNames,
  fmt,
  onAdd,
  onChange,
  onReview,
  header,
}: {
  menu: KioskMenu;
  basket: BasketLine[];
  unavailableNames: string[];
  fmt: (n: number) => string;
  onAdd: (line: Omit<BasketLine, "key" | "quantity">) => void;
  onChange: (key: string, delta: number) => void;
  onReview: () => void;
  header: React.ReactNode;
}) {
  const { t } = useI18n();
  const [categoryId, setCategoryId] = useState(menu.categories[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [picking, setPicking] = useState<KioskMenuItem | null>(null);

  const unit = (item: KioskMenuItem, extra = 0) =>
    toInclusiveUnitPrice(Number(item.price) + extra, Number(item.taxRatePercent), menu.taxMode);

  const visible = useMemo(() => {
    if (deferredQuery) {
      return menu.categories.flatMap((c) =>
        c.items.filter(
          (i) =>
            i.name.toLowerCase().includes(deferredQuery) ||
            (i.description ?? "").toLowerCase().includes(deferredQuery),
        ),
      );
    }
    return menu.categories.find((c) => c.id === categoryId)?.items ?? [];
  }, [menu, categoryId, deferredQuery]);

  const qtyOf = (itemId: string) =>
    basket.filter((l) => l.menuItemId === itemId).reduce((s, l) => s + l.quantity, 0);

  const add = (item: KioskMenuItem) => {
    if (item.modifierGroups.length > 0) setPicking(item);
    else onAdd({ menuItemId: item.id, name: item.name, modifierIds: [], modifierLabel: "", unitPrice: unit(item) });
  };
  const addWithChoice = (item: KioskMenuItem, c: ModifierChoice) => {
    onAdd({
      menuItemId: item.id,
      name: item.name,
      modifierIds: c.modifierIds,
      modifierLabel: c.label,
      unitPrice: unit(item, c.extra),
    });
    setPicking(null);
  };

  const count = basketCount(basket);
  const total = basketTotal(basket);

  return (
    <div className="flex h-full flex-col">
      {header}
      {unavailableNames.length > 0 && (
        <div className="px-4 pt-3">
          <Banner tone="warning" title={t("kiosk.menu.unavailable", { names: unavailableNames.join(", ") })} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* categories: rail on wide screens, scrolling row on narrow ones */}
        <nav
          aria-label={t("kiosk.menu.categories")}
          className="flex shrink-0 gap-2 overflow-x-auto border-b border-border p-3 md:w-[15rem] md:flex-col md:overflow-y-auto md:overflow-x-hidden md:border-b-0 md:border-r"
        >
          {menu.categories.map((c) => {
            const on = !deferredQuery && c.id === categoryId;
            return (
              <button
                key={c.id}
                type="button"
                aria-current={on ? "true" : undefined}
                onClick={() => {
                  setQuery("");
                  setCategoryId(c.id);
                }}
                className={cn(
                  "shrink-0 touch-manipulation select-none rounded-2xl px-4 text-left text-[1.2rem] font-semibold leading-tight",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
                  "py-3",
                  on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-muted",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </nav>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="p-3 pb-0">
            <label className="relative block">
              <span className="sr-only">{t("kiosk.menu.search")}</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, 40))}
                placeholder={t("kiosk.menu.search")}
                className={cn(
                  "w-full select-text rounded-2xl border-2 border-border bg-card pl-12 pr-14 text-[1.15rem] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30",
                  "py-3",
                )}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t("kiosk.menu.clearSearch")}
                  onClick={() => setQuery("")}
                  className={cn("absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full", TOUCH)}
                >
                  <X className="h-6 w-6" aria-hidden />
                </button>
              )}
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {visible.length === 0 ? (
              <p className="py-16 text-center text-[1.4rem] text-muted-foreground">
                {t("kiosk.menu.searchNone", { query })}
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
                {visible.map((item) => {
                  const qty = qtyOf(item.id);
                  return (
                    <li key={item.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-border bg-card">
                      {item.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt="" loading="lazy" decoding="async" className="h-32 w-full object-cover" />
                      )}
                      <div className="flex flex-1 flex-col gap-1 p-4">
                        <h3 className="text-[1.3rem] font-bold leading-tight">{item.name}</h3>
                        {item.description && (
                          <p className="line-clamp-2 text-[0.95rem] leading-snug text-muted-foreground">{item.description}</p>
                        )}
                        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                          <span className="text-[1.35rem] font-bold tabular-nums">{fmt(unit(item))}</span>
                          <KButton onClick={() => add(item)} aria-label={`${t("kiosk.menu.add")} ${item.name}`}>
                            <Plus className="h-5 w-5" aria-hidden />
                            {t("kiosk.menu.add")}
                            {qty > 0 && (
                              <span className="ml-1 rounded-full bg-primary-foreground/25 px-2 text-[0.95rem] tabular-nums">×{qty}</span>
                            )}
                          </KButton>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </main>

        {/* basket: side panel on wide screens */}
        <aside className="hidden w-[26rem] shrink-0 flex-col border-l border-border bg-card lg:flex">
          <h2 className="flex items-center gap-3 border-b border-border p-4 text-[1.5rem] font-bold">
            <ShoppingBag className="h-6 w-6 text-primary" aria-hidden />
            {t("kiosk.basket.title")}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {basket.length === 0 ? (
              <p className="py-12 text-center text-[1.15rem] text-muted-foreground">{t("kiosk.basket.empty")}</p>
            ) : (
              <BasketLines lines={basket} fmt={fmt} locked={false} onChange={onChange} />
            )}
          </div>
          <div className="space-y-3 border-t border-border p-4">
            <div className="flex items-baseline justify-between text-[1.5rem] font-bold">
              <span>{t("kiosk.basket.total")}</span>
              <span className="tabular-nums">{fmt(total)}</span>
            </div>
            <KButton large className="w-full" disabled={count === 0} onClick={onReview}>
              {t("kiosk.basket.review")}
            </KButton>
          </div>
        </aside>
      </div>

      {/* basket: bottom bar on narrow screens */}
      <div className="flex items-center gap-3 border-t border-border bg-card p-3 lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-[1rem] text-muted-foreground">
            {count === 1 ? t("kiosk.basket.item") : t("kiosk.basket.items", { count })}
          </p>
          <p className="text-[1.5rem] font-bold tabular-nums">{fmt(total)}</p>
        </div>
        <KButton large disabled={count === 0} onClick={onReview}>
          {t("kiosk.basket.review")}
        </KButton>
      </div>

      {picking && (
        <ModifierSheet
          key={picking.id}
          item={picking}
          priceText={fmt}
          onCancel={() => setPicking(null)}
          onConfirm={(c) => addWithChoice(picking, c)}
        />
      )}
    </div>
  );
}
