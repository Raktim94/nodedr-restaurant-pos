"use client";

import { ArrowLeft, CreditCard, Gift, Star } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useCustomer } from "@/hooks/use-customers";
import { formatCurrency } from "@/lib/format";

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { branchId } = useBranch();
  const { data: customer, isLoading } = useCustomer(branchId, id);

  if (isLoading || !customer) {
    return <Skeleton className="h-96 rounded-2xl" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/customers"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Customers
        </Link>
        <h1 className="mt-2 text-[32px] font-semibold tracking-tight text-foreground">
          {customer.name ?? "Unnamed customer"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[customer.phone, customer.email, customer.address].filter(Boolean).join(" · ") ||
            "No contact info on file"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <Star className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Loyalty points</p>
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {customer.loyaltyPoints}
            </p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Store credit</p>
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {formatCurrency(customer.walletBalance)}
            </p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gift cards</p>
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {customer.giftCards.length}
            </p>
          </div>
        </Card>
      </div>

      {customer.allergies && (
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Allergies
          </p>
          <p className="mt-1 text-sm text-destructive">{customer.allergies}</p>
        </Card>
      )}

      {customer.giftCards.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-[18px] font-medium text-foreground">Gift cards</h2>
          <div className="flex flex-col divide-y divide-border">
            {customer.giftCards.map((gc) => (
              <div key={gc.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono text-muted-foreground">{gc.code}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(gc.balance)} / {formatCurrency(gc.initialValue)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[18px] font-medium text-foreground">Order history</h2>
        {customer.orders.length > 0 ? (
          <div className="flex flex-col divide-y divide-border">
            {customer.orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">#{o.orderNumber}</span>
                  <Badge variant="secondary" className="mt-0.5 w-fit text-[11px] font-normal">
                    {new Date(o.billedAt).toLocaleDateString()}
                  </Badge>
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(o.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">No paid orders yet.</p>
        )}
      </Card>
    </div>
  );
}
