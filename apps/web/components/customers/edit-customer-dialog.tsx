"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateCustomer, type Customer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api";

// Mounted only while a specific customer is being edited (see CustomersPage
// / customer detail page), keyed by customer.id — same pattern as
// EditRoleDialog/EditCategoryDialog.
export function EditCustomerDialog({
  branchId,
  customer,
  onClose,
}: {
  branchId: string | null;
  customer: Customer;
  onClose: () => void;
}) {
  const [name, setName] = useState(customer.name ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [allergies, setAllergies] = useState(customer.allergies ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [optOut, setOptOut] = useState(customer.marketingOptOut ?? false);
  const updateCustomer = useUpdateCustomer(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCustomer.mutate(
      {
        id: customer.id,
        dto: {
          name: name || undefined,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          allergies: allergies || undefined,
          notes: notes || undefined,
          marketingOptOut: optOut,
        },
      },
      {
        onSuccess: () => {
          toast.success(`${name || "Customer"} updated`);
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not update customer"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-edit-name">Name</Label>
            <Input id="c-edit-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-edit-phone">Phone</Label>
            <Input id="c-edit-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-edit-email">Email</Label>
            <Input
              id="c-edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-edit-address">Address</Label>
            <Input id="c-edit-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-edit-allergies">Allergies</Label>
            <Input
              id="c-edit-allergies"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-edit-notes">Notes</Label>
            <Textarea id="c-edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} />
            Do not send marketing messages to this customer
          </label>
          <DialogFooter>
            <Button type="submit" disabled={updateCustomer.isPending}>
              {updateCustomer.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
