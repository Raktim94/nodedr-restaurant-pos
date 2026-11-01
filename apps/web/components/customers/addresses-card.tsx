"use client";

import { formatCustomerAddress } from "@nodedr-restaurant/types";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import {
  useAddAddress,
  useDeleteAddress,
  useUpdateAddress,
  type CustomerAddress,
} from "@/hooks/use-customers";
import { ApiError } from "@/lib/api";

const EMPTY = {
  label: "",
  line1: "",
  street: "",
  landmark: "",
  city: "",
  state: "",
  pincode: "",
  instructions: "",
};

export function AddressesCard({
  branchId,
  customerId,
  addresses,
}: {
  branchId: string | null;
  customerId: string;
  addresses: CustomerAddress[];
}) {
  const [editing, setEditing] = useState<CustomerAddress | "new" | null>(null);
  const update = useUpdateAddress(branchId, customerId);
  const remove = useDeleteAddress(branchId, customerId);
  const { note, clear, toast } = useNoteToast();

  const fail = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : "Could not save the address");

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[18px] font-medium text-foreground">Delivery addresses</h2>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" />
          Add address
        </Button>
      </div>
      <StatusNote note={note} onClear={clear} />
      {addresses.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          No saved addresses yet. Add one to pick it quickly on delivery orders.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {addresses.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-3">
              <div className="flex min-w-0 gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    {a.label || "Address"}
                    {a.isDefault && <Badge variant="secondary">Default</Badge>}
                  </p>
                  <p className="[overflow-wrap:anywhere] text-muted-foreground">
                    {formatCustomerAddress(a)}
                    {a.pincode ? ` – ${a.pincode}` : ""}
                  </p>
                  {a.instructions && (
                    <p className="text-xs text-muted-foreground">Note: {a.instructions}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {!a.isDefault && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Make default address"
                    title="Make default"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({ id: a.id, dto: { isDefault: true } }, { onError: fail })
                    }
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Edit address"
                  onClick={() => setEditing(a)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Delete address"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!confirm("Delete this address? Past orders keep the address they were sent to.")) return;
                    remove.mutate(a.id, {
                      onSuccess: () => toast.success("Address deleted"),
                      onError: fail,
                    });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AddressDialog
          key={editing === "new" ? "new" : editing.id}
          branchId={branchId}
          customerId={customerId}
          address={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function AddressDialog({
  branchId,
  customerId,
  address,
  onClose,
}: {
  branchId: string | null;
  customerId: string;
  address: CustomerAddress | null;
  onClose: () => void;
}) {
  const add = useAddAddress(branchId, customerId);
  const update = useUpdateAddress(branchId, customerId);
  const { note, clear, toast } = useNoteToast();
  const [f, setF] = useState(
    address
      ? {
          label: address.label ?? "",
          line1: address.line1,
          street: address.street ?? "",
          landmark: address.landmark ?? "",
          city: address.city ?? "",
          state: address.state ?? "",
          pincode: address.pincode ?? "",
          instructions: address.instructions ?? "",
        }
      : EMPTY,
  );
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });
  const pending = add.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Empty optional fields are omitted so the API's own validation applies.
    const dto = Object.fromEntries(
      Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v || k === "line1"),
    ) as typeof EMPTY;
    const opts = {
      // The list behind the dialog shows the saved address; errors stay here.
      onSuccess: onClose,
      onError: (err: unknown) =>
        toast.error(err instanceof ApiError ? err.message : "Could not save the address"),
    };
    if (address) update.mutate({ id: address.id, dto }, opts);
    else add.mutate(dto, opts);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{address ? "Edit address" : "Add address"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-label">Label</Label>
              <Input id="a-label" value={f.label} onChange={set("label")} placeholder="Home, Office" maxLength={40} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-pin">PIN / postal code</Label>
              <Input id="a-pin" value={f.pincode} onChange={set("pincode")} inputMode="numeric" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-line1">House / flat / building *</Label>
            <Input id="a-line1" value={f.line1} onChange={set("line1")} required maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-street">Street / locality</Label>
            <Input id="a-street" value={f.street} onChange={set("street")} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-landmark">Landmark</Label>
            <Input id="a-landmark" value={f.landmark} onChange={set("landmark")} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-city">City</Label>
              <Input id="a-city" value={f.city} onChange={set("city")} maxLength={100} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="a-state">State</Label>
              <Input id="a-state" value={f.state} onChange={set("state")} maxLength={100} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="a-notes">Delivery instructions</Label>
            <Input id="a-notes" value={f.instructions} onChange={set("instructions")} maxLength={300} />
          </div>
          <StatusNote note={note} onClear={clear} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !f.line1.trim()}>
              {pending ? "Saving…" : "Save address"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
