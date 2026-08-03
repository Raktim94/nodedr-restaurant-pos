"use client";

import { Leaf, UtensilsCrossed } from "lucide-react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
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

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-menu", qrToken],
    queryFn: () => api.get<PublicMenuResponse>(`/public/menu/${qrToken}`),
    retry: false,
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

  return (
    <div className="min-h-screen bg-background">
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
                  {category.items.map((item) => (
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
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(item.price)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border px-5 py-6 text-center text-xs text-muted-foreground">
        Ask your server to place an order — online ordering from this menu is coming soon.
      </footer>
    </div>
  );
}
