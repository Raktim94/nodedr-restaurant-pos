"use client";

import { UserRound, X } from "lucide-react";
import { useState } from "react";
import { AddCustomerDialog } from "@/components/customers/add-customer-dialog";
import { Input } from "@/components/ui/input";
import { useCustomers, type Customer } from "@/hooks/use-customers";

export function CustomerPicker({
  branchId,
  customer,
  onSelect,
}: {
  branchId: string | null;
  customer: Customer | null;
  onSelect: (customer: Customer | null) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: matches } = useCustomers(branchId, search.length >= 2 ? search : undefined);

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{customer.name ?? customer.phone}</span>
          <span className="text-xs text-muted-foreground">{customer.loyaltyPoints} pts</span>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <Input
        placeholder="Attach customer (name or phone)…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="flex-1"
      />
      <AddCustomerDialog branchId={branchId} onCreated={(c) => onSelect(c)} />
      {search.length >= 2 && matches && matches.length > 0 && (
        <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-md">
          {matches.slice(0, 5).map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary"
              onClick={() => {
                onSelect(m);
                setSearch("");
              }}
            >
              <span className="font-medium text-foreground">{m.name ?? "Unnamed"}</span>
              <span className="text-xs text-muted-foreground">{m.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
