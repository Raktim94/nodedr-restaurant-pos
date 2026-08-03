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
import { useCreateSupplier } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

export function AddSupplierDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const createSupplier = useCreateSupplier(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createSupplier.mutate(
      {
        name,
        contactName: contactName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        isActive: true,
      },
      {
        onSuccess: () => {
          toast.success(`${name} added`);
          setOpen(false);
          setName("");
          setContactName("");
          setPhone("");
          setEmail("");
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add supplier"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New supplier</Button>} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New supplier</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-name">Business name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-contact">Contact person</Label>
            <Input id="s-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-phone">Phone</Label>
            <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-email">Email</Label>
            <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createSupplier.isPending}>
              {createSupplier.isPending ? "Adding…" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
