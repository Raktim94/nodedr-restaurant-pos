"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
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
import { PIN_RE } from "@/components/customers/add-customer-dialog";

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
  const [pincode, setPincode] = useState(customer.pincode ?? "");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(customer.status ?? "ACTIVE");
  const [pinError, setPinError] = useState<string | null>(null);
  const [allergies, setAllergies] = useState(customer.allergies ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [optOut, setOptOut] = useState(customer.marketingOptOut ?? false);
  const updateCustomer = useUpdateCustomer(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pincode.trim() && !PIN_RE.test(pincode.trim())) return setPinError("Enter a valid PIN / postal code (3-10 letters or digits).");
    setPinError(null);
    updateCustomer.mutate(
      {
        id: customer.id,
        dto: {
          name: name || undefined,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          pincode: pincode.trim(), // empty clears it
          status,
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
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-sm">
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
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-edit-pin">PIN code</Label>
              <Input id="c-edit-pin" value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" autoComplete="postal-code" aria-invalid={!!pinError} aria-describedby={pinError ? "c-edit-pin-err" : undefined} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-edit-status">Status</Label>
              <select id="c-edit-status" value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          {pinError && <p id="c-edit-pin-err" role="alert" className="text-sm text-destructive">{pinError}</p>}
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
