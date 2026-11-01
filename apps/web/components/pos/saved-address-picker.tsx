"use client";

import { formatCustomerAddress } from "@nodedr-restaurant/types";
import { useEffect, useState } from "react";
import { useCustomerAddresses, useCustomers } from "@/hooks/use-customers";

// Phone-first lookup: once the typed phone number matches exactly one saved
// customer, their saved addresses are offered as one-tap fills. Nothing is
// guessed - no match, or several, shows nothing and staff just type.
export function SavedAddressPicker({
  branchId,
  phone,
  onPick,
}: {
  branchId: string | null;
  phone: string;
  onPick: (address: string, pincode: string) => void;
}) {
  const digits = phone.replace(/\D/g, "");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(digits.length >= 8 ? digits : ""), 400);
    return () => clearTimeout(t);
  }, [digits]);

  const customers = useCustomers(branchId, debounced || undefined);
  const matches = debounced
    ? (customers.data ?? []).filter((c) => (c.phone ?? "").replace(/\D/g, "").endsWith(debounced.slice(-10)))
    : [];
  const customer = matches.length === 1 ? matches[0] : null;
  const addresses = useCustomerAddresses(branchId, customer?.id ?? null);

  if (!customer || !addresses.data || addresses.data.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-secondary/60 p-2" role="group" aria-label={`Saved addresses for ${customer.name ?? "customer"}`}>
      <p className="text-xs text-muted-foreground">
        Saved addresses for <span className="font-medium text-foreground">{customer.name ?? "this customer"}</span>
      </p>
      <div className="flex flex-col gap-1">
        {addresses.data.map((a) => (
          <button
            key={a.id}
            type="button"
            title={formatCustomerAddress(a)}
            onClick={() => onPick(formatCustomerAddress(a), a.pincode ?? "")}
            className="min-h-9 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-secondary"
          >
            <span className="font-medium text-foreground">{a.label || "Address"}</span>
            {a.isDefault ? " · default" : ""}
            <span className="line-clamp-2 [overflow-wrap:anywhere] text-muted-foreground">
              {formatCustomerAddress(a)}
              {a.pincode ? ` – ${a.pincode}` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
