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
import { Textarea } from "@/components/ui/textarea";
import { ClipboardPaste, TriangleAlert } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSupplierInvoice, useParseInvoiceText, useSuppliers, type ParsedInvoice } from "@/hooks/use-inventory";
import { ApiError } from "@/lib/api";

export function CreateInvoiceDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const { data: suppliers } = useSuppliers(branchId);
  const createInvoice = useCreateSupplierInvoice(branchId);
  const parseText = useParseInvoiceText(branchId);
  const [pasted, setPasted] = useState("");
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null);

  const readInvoice = () => {
    parseText.mutate(pasted, {
      onSuccess: (r) => {
        setParsed(r);
        if (r.invoiceNumber) setInvoiceNumber(r.invoiceNumber);
        if (r.invoiceDate) setInvoiceDate(r.invoiceDate);
        if (r.dueDate) setDueDate(r.dueDate);
        if (r.totalAmount !== null) setTotalAmount(String(r.totalAmount));
        // Only pre-pick a supplier on an exact (case-insensitive) name match.
        const match = suppliers?.find((s) => r.supplierName && s.name.trim().toLowerCase() === r.supplierName.trim().toLowerCase());
        if (match) setSupplierId(match.id);
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not read the invoice text"),
    });
  };

  const canSubmit = !!supplierId && !!invoiceNumber && !!invoiceDate && Number(totalAmount) > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createInvoice.mutate(
      {
        supplierId,
        invoiceNumber,
        invoiceDate: new Date(invoiceDate),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        totalAmount: Number(totalAmount),
      },
      {
        onSuccess: (invoice) => {
          toast.success(`${invoice.invoiceNumber} added`);
          setOpen(false);
          setSupplierId("");
          setInvoiceNumber("");
          setDueDate("");
          setTotalAmount("");
          setPasted("");
          setParsed(null);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not add supplier invoice"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">New invoice</Button>} />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a vendor invoice</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
            <Label htmlFor="inv-paste" className="flex items-center gap-1.5">
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> Paste invoice text to fill this in (optional)
            </Label>
            <Textarea
              id="inv-paste"
              rows={3}
              maxLength={20000}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"Invoice No: FF/2026/0457\nDate: 03/11/2026\nGrand Total: ₹ 4,500.00"}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Copy the text from the PDF or email. Nothing is saved until you add the invoice.</p>
              <Button type="button" variant="secondary" size="sm" disabled={!pasted.trim() || parseText.isPending} onClick={readInvoice}>
                {parseText.isPending ? "Reading…" : "Read invoice"}
              </Button>
            </div>
            {parsed && (
              <div
                role="status"
                className={`flex gap-2 rounded-md p-2 text-xs ${parsed.requiresReview ? "bg-warning/15 text-foreground" : "bg-success/10 text-foreground"}`}
              >
                {parsed.requiresReview && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />}
                <div>
                  <p className="font-medium">
                    {parsed.requiresReview ? "Please check these fields before saving" : "Filled in. Please confirm the details."}
                  </p>
                  {parsed.supplierName && <p className="text-muted-foreground">Supplier on invoice: {parsed.supplierName}{parsed.gstin ? ` · GSTIN ${parsed.gstin}` : ""}</p>}
                  {parsed.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label id="inv-supplier-label">Supplier</Label>
            <Select value={supplierId} onValueChange={(v) => setSupplierId(v ?? "")}>
              <SelectTrigger aria-labelledby="inv-supplier-label">
                <SelectValue placeholder="Select a supplier" />
              </SelectTrigger>
              <SelectContent>
                {suppliers?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-number">Invoice number</Label>
            <Input id="inv-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-date">Invoice date</Label>
              <Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-due">Due date</Label>
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-total">Total amount</Label>
            <Input
              id="inv-total"
              type="number"
              min="0"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || createInvoice.isPending}>
              {createInvoice.isPending ? "Saving…" : "Add invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
