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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecordSupplierPayment, type SupplierInvoice } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

const METHODS = ["CASH", "CARD", "UPI", "BANK_TRANSFER", "WALLET"] as const;

export function RecordPaymentDialog({
  branchId,
  invoice,
}: {
  branchId: string | null;
  invoice: SupplierInvoice;
}) {
  const [open, setOpen] = useState(false);
  const remaining = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  const [amount, setAmount] = useState(() => String(remaining));
  const [method, setMethod] = useState<(typeof METHODS)[number]>("CASH");
  const [reference, setReference] = useState("");
  const recordPayment = useRecordSupplierPayment(branchId);

  const canSubmit = Number(amount) > 0 && Number(amount) <= remaining;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    recordPayment.mutate(
      {
        invoiceId: invoice.id,
        dto: { amount: Number(amount), paymentMethod: method, reference: reference || undefined },
      },
      {
        onSuccess: () => {
          toast.success("Payment recorded");
          setOpen(false);
          setReference("");
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not record payment"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">Record payment</Button>} />
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {invoice.invoiceNumber} — {formatCurrency(remaining)} remaining of{" "}
            {formatCurrency(Number(invoice.totalAmount))}
          </p>

          <div className="flex flex-col gap-2">
            <Label>Amount</Label>
            <Input
              type="number"
              min="0"
              max={remaining}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod((v as typeof method) ?? "CASH")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Reference</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UTR / cheque no. (optional)"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || recordPayment.isPending}>
              {recordPayment.isPending ? "Recording…" : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
