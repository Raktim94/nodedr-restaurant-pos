"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { fetchSlip, useHrActions, type PayrollRunDetail, type SalarySlip } from "@/hooks/use-hr";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");
type Line = PayrollRunDetail["lines"][number];

export function AdjustLineDialog({
  branchId,
  runId,
  line,
  onClose,
}: {
  branchId: string | null;
  runId: string;
  line: Line;
  onClose: () => void;
}) {
  const { adjustLine } = useHrActions(branchId);
  const { note, clear, toast } = useNoteToast();
  const [f, setF] = useState({
    allowances: String(Number(line.allowances)),
    bonus: String(Number(line.bonus)),
    advanceRecovery: String(Number(line.advanceRecovery)),
    otherDeductions: String(Number(line.otherDeductions)),
    adjustmentNote: line.adjustmentNote ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    adjustLine.mutate(
      {
        runId,
        userId: line.user.id,
        dto: {
          allowances: Number(f.allowances) || 0,
          bonus: Number(f.bonus) || 0,
          advanceRecovery: Number(f.advanceRecovery) || 0,
          otherDeductions: Number(f.otherDeductions) || 0,
          adjustmentNote: f.adjustmentNote,
        },
      },
      {
        // The row behind the dialog updates itself; an error stays here, visible.
        onSuccess: onClose,
        onError: (err) => toast.error(errMsg(err)),
      },
    );
  };
  const num = (id: string, label: string, k: keyof typeof f, sign: "+" | "−") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label} <span className="text-muted-foreground">({sign})</span>
      </Label>
      <Input id={id} type="number" min="0" step="0.01" inputMode="decimal" value={f[k]} onChange={set(k)} />
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust pay — {line.user.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {num("p-allow", "Allowances", "allowances", "+")}
            {num("p-bonus", "Bonus", "bonus", "+")}
            {num("p-adv", "Advance recovery", "advanceRecovery", "−")}
            {num("p-other", "Other deductions", "otherDeductions", "−")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-note">Note</Label>
            <Input id="p-note" maxLength={200} value={f.adjustmentNote} onChange={set("adjustmentNote")} />
          </div>
          <StatusNote note={note} onClear={clear} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={adjustLine.isPending}>
              {adjustLine.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayRunDialog({
  branchId,
  runId,
  total,
  onClose,
}: {
  branchId: string | null;
  runId: string;
  total: string;
  onClose: () => void;
}) {
  const { payRun } = useHrActions(branchId);
  const { note, clear, toast } = useNoteToast();
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER" | "UPI" | "OTHER">("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark salaries as paid</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This records that <span className="font-medium text-foreground">{formatCurrency(total)}</span> was paid out.
          It can only be done once and locks the run.
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-method">Paid by</Label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="UPI">UPI</option>
              <option value="CASH">Cash</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input id="pay-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <StatusNote note={note} onClear={clear} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={payRun.isPending}
            onClick={() =>
              payRun.mutate(
                { id: runId, method, reference: reference.trim() || undefined },
                {
                  onSuccess: onClose,
                  onError: (e) => toast.error(errMsg(e)),
                },
              )
            }
          >
            {payRun.isPending ? "Saving…" : "Confirm payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const day = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function slipHtml(s: SalarySlip) {
  const row = (label: string, v: number) => (v ? `<tr><td>${esc(label)}</td><td class="r">${esc(formatCurrency(v))}</td></tr>` : "");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Salary slip - ${esc(s.employee)}</title>
<style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{font-size:18px;margin:0}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;color:#555}
table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px solid #eee}.r{text-align:right}.net td{font-weight:700;border-top:2px solid #111;border-bottom:0;font-size:16px}.m{color:#555}</style></head><body>
<h1>${esc(s.employer)}</h1><div class="m">${esc(s.branch)}${s.address ? " · " + esc(s.address) : ""}</div>
<h2>Salary slip</h2><div><b>${esc(s.employee)}</b></div>
<div class="m">Period ${esc(day(s.periodStart))} – ${esc(day(s.periodEnd))} · ${esc(s.hoursWorked)} h worked</div>
<h2>Earnings</h2><table>${row("Base pay", s.earnings.basePay)}${row("Tip share", s.earnings.tipShare)}${row("Allowances", s.earnings.allowances)}${row("Bonus", s.earnings.bonus)}</table>
<h2>Deductions</h2><table>${row("Unpaid leave", s.deductions.unpaidLeave)}${row("Advance recovery", s.deductions.advanceRecovery)}${row("Other deductions", s.deductions.other)}</table>
<table style="margin-top:14px"><tr class="net"><td>Net pay</td><td class="r">${esc(formatCurrency(s.netPay))}</td></tr></table>
${s.note ? `<p class="m">Note: ${esc(s.note)}</p>` : ""}
<p class="m">${s.status === "PAID" && s.paidAt ? "Paid on " + esc(day(s.paidAt)) + (s.paymentMethod ? " by " + esc(s.paymentMethod.replace("_", " ").toLowerCase()) : "") : "Status: " + esc(s.status.toLowerCase()) + " (not yet paid)"}</p>
<script>window.onload=function(){window.print()}</script></body></html>`;
}

export function SlipButton({ branchId, runId, userId }: { branchId: string | null; runId: string; userId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
    {failed && (
      <span role="alert" className="mr-1 text-xs text-destructive">
        {failed}
      </span>
    )}
    <Button
      size="sm"
      variant="ghost"
      className="h-8 px-2"
      disabled={busy}
      aria-label="Print salary slip"
      onClick={async () => {
        // Open synchronously (a popup blocker only allows it inside the click), fill after the fetch.
        setFailed(null);
        const w = window.open("", "_blank");
        if (!w) return void setFailed("Allow pop-ups to print");
        setBusy(true);
        try {
          const slip = await fetchSlip(branchId, runId, userId);
          w.document.open();
          w.document.write(slipHtml(slip));
          w.document.close();
        } catch (e) {
          w.close();
          setFailed(errMsg(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Printer className="h-4 w-4" />
    </Button>
    </>
  );
}
