"use client";

import { Gift, Pencil, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AddCustomerDialog } from "@/components/customers/add-customer-dialog";
import { EditCustomerDialog } from "@/components/customers/edit-customer-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useCustomers, useDeleteCustomer, type Customer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api";

export default function CustomersPage() {
  const { branchId } = useBranch();
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useCustomers(branchId, search || undefined);
  const deleteCustomer = useDeleteCustomer(branchId);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const onDelete = (e: React.MouseEvent, customer: Customer) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete ${customer.name ?? "this customer"}? This cannot be undone.`)) return;
    deleteCustomer.mutate(customer.id, {
      onSuccess: () => toast.success(`${customer.name ?? "Customer"} deleted`),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not delete customer"),
    });
  };

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
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    title="Edit customer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingCustomer(c);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    title="Delete customer"
                    onClick={(e) => onDelete(e, c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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

      {editingCustomer && (
        <EditCustomerDialog
          branchId={branchId}
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
        />
      )}
    </div>
  );
}
