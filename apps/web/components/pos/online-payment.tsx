"use client";

import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Copy, ExternalLink, FlaskConical, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useActiveGateway,
  useCreateGatewayPayment,
  useRefreshGatewayPayment,
  type GatewayPaymentRow,
} from "@/hooks/use-payment-gateways";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { fromMinorUnits } from "@/lib/money-units";

// Offers the customer a provider-hosted payment page for the bill's balance.
// The amount is worked out by the server; this only asks for a link, shows it
// and re-checks its status. "Paid" here is whatever the server says after it
// has asked the provider itself, never what the customer's browser reports.
export function OnlinePayment({ orderId, branchId, disabled }: { orderId: string; branchId: string | null; disabled?: boolean }) {
  const { data: active } = useActiveGateway();
  const create = useCreateGatewayPayment(branchId ?? "");
  const refresh = useRefreshGatewayPayment(branchId ?? "");
  const qc = useQueryClient();
  const [pay, setPay] = useState<GatewayPaymentRow | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const waiting = pay?.status === "CREATED";
  useEffect(() => {
    if (!waiting || !pay) return;
    const t = setInterval(() => {
      refresh.mutate(pay.id, {
        onSuccess: (r) => {
          setPay(r);
          if (r.status === "SUCCEEDED" && r.mode === "LIVE") void qc.invalidateQueries();
        },
      });
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, pay?.id]);

  if (!active || !branchId) return null;

  const start = () => {
    setError(null);
    create.mutate(
      { orderId, customerPhone: phone },
      { onSuccess: setPay, onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create the payment link") },
    );
  };
  const amount = pay ? formatCurrency(fromMinorUnits(pay.amountMinor, pay.currency), pay.currency) : "";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Globe className="h-4 w-4" aria-hidden /> Pay online with {active.name}
        {active.mode === "TEST" && (
          <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
            <FlaskConical className="h-3 w-3" aria-hidden /> Test mode
          </span>
        )}
      </div>

      {!pay || pay.status === "EXPIRED" || pay.status === "FAILED" ? (
        <>
          {active.requiresCustomerPhone && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="gw-phone" className="text-xs">Customer phone (required by {active.name})</Label>
              <Input id="gw-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          )}
          <Button type="button" variant="outline" disabled={disabled || create.isPending || (active.requiresCustomerPhone && phone.length < 6)} onClick={start}>
            {create.isPending ? "Creating link…" : "Create payment link for the balance"}
          </Button>
          {pay?.status === "EXPIRED" && <p className="text-xs text-muted-foreground">The last link expired. Create a new one.</p>}
        </>
      ) : null}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {pay?.status === "CREATED" && pay.checkoutUrl && (
        <div className="flex flex-col items-center gap-2 rounded-lg bg-white p-3">
          <QRCodeSVG value={pay.checkoutUrl} size={168} level="M" marginSize={1} />
          <p className="text-xs font-medium text-[#17251d]">Scan to pay {amount}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => window.open(pay.checkoutUrl!, "_blank", "noopener,noreferrer")}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(pay.checkoutUrl!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
              <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-neutral-600" role="status">Waiting for the customer to pay… this updates by itself.</p>
        </div>
      )}

      {pay?.status === "SUCCEEDED" && (
        <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {pay.mode === "TEST"
            ? `Test payment of ${amount} worked. No real money moved and the bill is still unpaid.`
            : `Paid ${amount} online.`}
        </p>
      )}
      {pay?.status === "NEEDS_REVIEW" && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          A payment needs attention: {pay.note ?? "check the provider dashboard"}. It is listed under Settings → Payments.
        </p>
      )}
    </div>
  );
}
