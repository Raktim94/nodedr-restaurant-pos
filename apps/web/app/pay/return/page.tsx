"use client";

import { CheckCircle2, Clock, FlaskConical, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

type State = "CREATED" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "NEEDS_REVIEW" | "UNKNOWN";

// Where a customer lands after the provider's payment page. This page is a
// courtesy: it asks OrderRestro's server for the status, and the server asks
// the provider. Nothing here (or in the URL) can mark anything as paid.
function Return() {
  const gp = useSearchParams().get("gp");
  const [state, setState] = useState<State>("CREATED");
  const [test, setTest] = useState(false);

  useEffect(() => {
    if (!gp) return;
    let stop = false;
    let tries = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/payment-gateways/return-status/${encodeURIComponent(gp)}`);
        if (!r.ok) throw new Error();
        const j = (await r.json()) as { status: State; test: boolean };
        if (stop) return;
        failures = 0;
        setState(j.status);
        setTest(j.test);
        if (j.status !== "CREATED" && j.status !== "NEEDS_REVIEW") return;
      } catch {
        if (stop) return;
        // One network blip must not tell a paying customer their payment was
        // lost while the provider may still be confirming it.
        if (++failures >= 3) {
          setState("UNKNOWN");
          return;
        }
      }
      if (++tries < 30 && !stop) timer = setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [gp]);

  const view =
    state === "SUCCEEDED"
      ? test
        ? { Icon: FlaskConical, title: "Test payment received", body: "This was a test, so no real money moved." }
        : { Icon: CheckCircle2, title: "Thank you — payment received", body: "You can close this page. The restaurant has been told." }
      : state === "FAILED" || state === "EXPIRED"
        ? { Icon: XCircle, title: "This payment was not completed", body: "Please ask the restaurant for a new payment link." }
        : state === "UNKNOWN" || !gp
          ? { Icon: XCircle, title: "We could not find this payment", body: "Please check with the restaurant." }
          : { Icon: Clock, title: "Confirming your payment…", body: "This can take a few seconds. Please keep this page open." };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <view.Icon className="h-12 w-12" aria-hidden />
      <h1 className="text-2xl font-semibold" role="status" aria-live="polite">{view.title}</h1>
      <p className="text-muted-foreground">{view.body}</p>
    </main>
  );
}

export default function PayReturnPage() {
  return (
    <Suspense fallback={null}>
      <Return />
    </Suspense>
  );
}
