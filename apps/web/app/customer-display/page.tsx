"use client";

import { useEffect, useState } from "react";
import { subscribeDisplay, type DisplayState } from "@/lib/customer-display";
import { formatCurrency } from "@/lib/format";
import { playPaymentReceived } from "@/lib/celebrate";
import { QRCodeSVG } from "qrcode.react";

/**
 * Open this on the customer-facing screen (or second monitor):
 * /customer-display. It shows the order being rung up on the POS in the
 * browser window next to it, then a thank-you once it is paid.
 */
export default function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayState>({ kind: "idle" });
  useEffect(() => subscribeDisplay(setState), []);

  // Chime when the payment lands. Browsers only allow audio after a click on
  // the page, so the first tap on the display arms sound for the session.
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    if (state.kind === "paid" && soundOn) playPaymentReceived(formatCurrency(state.total));
  }, [state, soundOn]);

  // After "paid", fall back to the welcome screen for the next guest.
  useEffect(() => {
    if (state.kind !== "paid") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 8000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <main
      className="relative flex min-h-screen flex-col bg-background p-10 text-foreground"
      onClick={() => setSoundOn(true)}
    >
      {!soundOn && (
        <p className="absolute right-4 top-4 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Tap anywhere to enable payment sound
        </p>
      )}
      {state.kind === "idle" && (
        <div className="m-auto text-center">
          <p className="text-5xl font-semibold tracking-tight">Welcome</p>
          <p className="mt-3 text-xl text-muted-foreground">Your order will appear here</p>
        </div>
      )}

      {state.kind === "cart" && (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          <p className="mb-6 text-2xl font-semibold">Your order</p>
          <ul className="flex flex-1 flex-col divide-y divide-border">
            {state.lines.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-6 py-4 text-3xl">
                <span>
                  <span className="mr-4 text-muted-foreground">{l.quantity}×</span>
                  {l.name}
                </span>
                <span className="tabular-nums">{formatCurrency(l.total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-baseline justify-between border-t-2 border-foreground pt-6 text-5xl font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(state.subtotal)}</span>
          </div>
        </div>
      )}

      {state.kind === "upi" && (
        <div className="m-auto flex flex-col items-center text-center">
          <p className="text-3xl text-muted-foreground">Scan to pay</p>
          <p className="mt-2 text-7xl font-semibold tabular-nums tracking-tight">{formatCurrency(state.total)}</p>
          <div className="mt-8 rounded-3xl bg-white p-6 shadow-xl">
            <QRCodeSVG value={state.uri} size={320} level="M" marginSize={1} />
          </div>
          <p className="mt-6 text-xl text-muted-foreground">
            Pay {state.payee ? `to ${state.payee} ` : ""}with GPay, PhonePe, Paytm or any UPI app
          </p>
        </div>
      )}

      {state.kind === "paid" && (
        <div className="m-auto text-center">
          <p className="text-6xl font-semibold tracking-tight">Thank you!</p>
          <p className="mt-4 text-3xl text-muted-foreground tabular-nums">{formatCurrency(state.total)} paid</p>
        </div>
      )}
    </main>
  );
}
