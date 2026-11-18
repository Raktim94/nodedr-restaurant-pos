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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCustomer, type Customer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api";

/** Same rule the server and saved delivery addresses use. */
export const PIN_RE = /^[A-Za-z0-9 -]{3,10}$/;

export function AddCustomerDialog({
  branchId,
  onCreated,
}: {
  branchId: string | null;
  onCreated?: (customer: Customer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [pinError, setPinError] = useState<string | null>(null);
  const createCustomer = useCreateCustomer(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pincode.trim() && !PIN_RE.test(pincode.trim())) return setPinError("Enter a valid PIN / postal code (3-10 letters or digits).");
    setPinError(null);
    createCustomer.mutate(
      { name: name || undefined, phone: phone || undefined, email: email || undefined, address: address.trim() || undefined, pincode: pincode.trim() || undefined, status },
      {
        onSuccess: (customer) => {
          toast.success(`${name || "Customer"} added`);
          setOpen(false);
          setName("");
          setPhone("");
          setEmail("");
          setAddress("");
          setPincode("");
          setStatus("ACTIVE");
          onCreated?.(customer);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not add customer"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New customer</Button>} />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-phone">Phone</Label>
            <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-email">Email</Label>
            <Input
              id="c-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="c-address">Address</Label>
            <Input id="c-address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-pin">PIN code</Label>
              <Input id="c-pin" value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" autoComplete="postal-code" aria-invalid={!!pinError} aria-describedby={pinError ? "c-pin-err" : undefined} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-status">Status</Label>
              <select id="c-status" value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          {pinError && <p id="c-pin-err" role="alert" className="text-sm text-destructive">{pinError}</p>}
          <DialogFooter>
            <Button type="submit" disabled={createCustomer.isPending}>
              {createCustomer.isPending ? "Adding…" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
