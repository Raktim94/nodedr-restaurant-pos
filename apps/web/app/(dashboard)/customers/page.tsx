"use client";

import { Gift, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AddCustomerDialog } from "@/components/customers/add-customer-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useCustomers } from "@/hooks/use-customers";

export default function CustomersPage() {
  const { branchId } = useBranch();
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useCustomers(branchId, search || undefined);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground">Profiles, loyalty, and order history</p>
        </div>
        <AddCustomerDialog branchId={branchId} />
      </div>

      <Input
        placeholder="Search by name, phone, or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : customers && customers.length > 0 ? (
          customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-secondary"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {c.name ?? "Unnamed customer"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5" />
                  {c.loyaltyPoints} pts
                </span>
                {Number(c.walletBalance) > 0 && (
                  <span className="flex items-center gap-1">
                    <Gift className="h-3.5 w-3.5" />₹{c.walletBalance}
                  </span>
                )}
              </div>
            </Link>
          ))
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No customers yet</p>
            <p className="text-sm text-muted-foreground">
              Add a profile to start tracking loyalty and order history.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
