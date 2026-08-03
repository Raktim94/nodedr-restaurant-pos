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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCustomer, type Customer } from "@/hooks/use-customers";
import { ApiError } from "@/lib/api";

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
  const createCustomer = useCreateCustomer(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createCustomer.mutate(
      { name: name || undefined, phone: phone || undefined, email: email || undefined },
      {
        onSuccess: (customer) => {
          toast.success(`${name || "Customer"} added`);
          setOpen(false);
          setName("");
          setPhone("");
          setEmail("");
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
      <DialogContent className="sm:max-w-sm">
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
