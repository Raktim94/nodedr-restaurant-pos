"use client";

import { CheckCircle2, Leaf, Minus, Plus, UtensilsCrossed } from "lucide-react";
import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

interface PublicMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string;
  isVeg: boolean;
}

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
  const [cart, setCart] = useState<Record<string, number>>({});
  const [placed, setPlaced] = useState<{ orderNumber: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-menu", qrToken],
    queryFn: () => api.get<PublicMenuResponse>(`/public/menu/${qrToken}`),
    retry: false,
  });

  const placeOrder = useMutation({
    mutationFn: () =>
      api.post<{ orderNumber: string }>(`/public/menu/${qrToken}/order`, {
        items: Object.entries(cart).map(([menuItemId, quantity]) => ({
          menuItemId,
          quantity,
          modifierIds: [],
        })),
      }),
    onSuccess: (order) => {
      setPlaced(order);
      setCart({});
    },
  });

  const allItems = data?.categories.flatMap((c) => c.items) ?? [];
  const cartCount = Object.values(cart).reduce((sum, q) => sum + q, 0);
  const cartTotal = Object.entries(cart).reduce((sum, [itemId, qty]) => {
    const item = allItems.find((i) => i.id === itemId);
    return sum + (item ? Number(item.price) * qty : 0);
  }, 0);

  const addToCart = (itemId: string) =>
    setCart((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
  const removeFromCart = (itemId: string) =>
    setCart((prev) => {
      const next = { ...prev, [itemId]: (prev[itemId] ?? 0) - 1 };
      if (next[itemId] <= 0) delete next[itemId];
      return next;
    });

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <UtensilsCrossed className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">This QR code isn&apos;t recognized</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : "Please ask a staff member for help."}
        </p>
      </div>
    );
  }

  if (placed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <p className="text-lg font-medium text-foreground">Order sent to the kitchen</p>
        <p className="text-sm text-muted-foreground">Order #{placed.orderNumber}</p>
        <Button variant="outline" className="mt-2" onClick={() => setPlaced(null)}>
          Order more
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b border-border px-5 py-6 text-center">
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
                    const quantity = cart[item.id] ?? 0;
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
                              onClick={() => removeFromCart(item.id)}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-5 text-center text-sm tabular-nums">{quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => addToCart(item.id)}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => addToCart(item.id)}
                          >
                            Add
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

      <footer className="border-t border-border px-5 py-6 text-center text-xs text-muted-foreground">
        Prices include tax. A staff member will confirm your order shortly.
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
                ? "Placing order…"
                : `Place order — ${cartCount} item${cartCount > 1 ? "s" : ""} · ${formatCurrency(cartTotal)}`}
            </Button>
          </div>
          {placeOrder.isError && (
            <p className="mx-auto mt-2 max-w-lg text-center text-xs text-destructive">
              {placeOrder.error instanceof ApiError
                ? placeOrder.error.message
                : "Could not place order — please ask a staff member for help."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
