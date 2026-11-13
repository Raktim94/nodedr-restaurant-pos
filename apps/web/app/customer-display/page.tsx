"use client";

import { type AdItem, screenFor } from "@nodedr-restaurant/types";
import { useSearchParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { playPaymentReceived } from "@/lib/celebrate";
import { subscribeDisplay, type DisplayState } from "@/lib/customer-display";
import { formatCurrency } from "@/lib/format";

interface View {
  terminal: { id: string; name: string; idleSeconds: number; thankYouSeconds: number; adSlideSeconds: number; adFit: "contain" | "cover" };
  state: DisplayState;
  stateAt: number | null;
  serverTime: number;
  currency: string;
  ads: AdItem[];
}

/**
 * Customer-facing screen.
 *   /customer-display            same browser as the till (a second monitor): follows the POS window next to it.
 *   /customer-display?t=TOKEN    its own device (tablet, mini-PC): reads its state from the server by token and
 *                                plays the business's adverts while idle.
 * Rules (unit-tested in display-machine.spec.ts): an order in progress shows the instant it exists and adverts are
 * removed from the page, never layered over it; an order left alone returns to adverts after the idle time; a
 * payment QR stays up at least three minutes; "thank you" shows for a few seconds.
 */
export default function CustomerDisplayPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-black" />}>
      <Router />
    </Suspense>
  );
}

function Router() {
  const t = useSearchParams().get("t");
  return t ? <ServerDisplay token={t} /> : <LocalDisplay />;
}

// ---- the live order, payment and thank-you pictures (shared) --------------------------------------

function Welcome() {
  return (
    <div className="m-auto text-center">
      <p className="text-5xl font-semibold tracking-tight">Welcome</p>
      <p className="mt-3 text-xl text-muted-foreground">Your order will appear here</p>
    </div>
  );
}

function OrderScreen({ state, currency }: { state: DisplayState; currency: string }) {
  const money = (v: number) => formatCurrency(v, currency);
  if (state.kind === "cart") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col" data-screen="order">
        <p className="mb-6 text-2xl font-semibold">Your order</p>
        <ul className="flex flex-1 flex-col divide-y divide-border">
          {state.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-6 py-4 text-3xl">
              <span>
                <span className="mr-4 text-muted-foreground">{l.quantity}×</span>
                {l.name}
              </span>
              <span className="tabular-nums">{money(l.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-baseline justify-between border-t-2 border-foreground pt-6 text-5xl font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(state.subtotal)}</span>
        </div>
      </div>
    );
  }
  if (state.kind === "upi") {
    return (
      <div className="m-auto flex flex-col items-center text-center" data-screen="pay">
        <p className="text-3xl text-muted-foreground">Scan to pay</p>
        <p className="mt-2 text-7xl font-semibold tabular-nums tracking-tight">{money(state.total)}</p>
        <div className="mt-8 rounded-3xl bg-white p-6 shadow-xl">
          <QRCodeSVG value={state.uri} size={320} level="M" marginSize={1} />
        </div>
        <p className="mt-6 text-xl text-muted-foreground">Pay {state.payee ? `to ${state.payee} ` : ""}with GPay, PhonePe, Paytm or any UPI app</p>
      </div>
    );
  }
  if (state.kind === "paid") {
    return (
      <div className="m-auto text-center" data-screen="thanks">
        <p className="text-6xl font-semibold tracking-tight">Thank you!</p>
        <p className="mt-4 text-3xl tabular-nums text-muted-foreground">{money(state.total)} paid</p>
      </div>
    );
  }
  return <Welcome />;
}

// ---- same browser as the till ---------------------------------------------------------------------------

function LocalDisplay() {
  const [state, setState] = useState<DisplayState>({ kind: "idle" });
  useEffect(() => subscribeDisplay(setState), []);

  // Chime when the payment lands. Browsers only allow audio after a click on the page.
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
    <main className="relative flex min-h-screen flex-col bg-background p-10 text-foreground" onClick={() => setSoundOn(true)}>
      {!soundOn && <p className="absolute right-4 top-4 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Tap anywhere to enable payment sound</p>}
      <OrderScreen state={state} currency="INR" />
    </main>
  );
}

// ---- its own device: reads the server, plays adverts while idle -------------------------------------------

const POLL_MS = 1000;

function ServerDisplay({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<"missing" | "offline" | null>(null);
  const [lastOk, setLastOk] = useState(0);
  // server clock minus this device's clock, so a wrong tablet clock cannot confuse "how old is this order"
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const sent = Date.now();
      const res = await fetch(`/api/v1/public/display/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) return setError("missing");
      if (!res.ok) throw new Error(String(res.status));
      const v = (await res.json()) as View;
      setOffset(v.serverTime - (sent + Date.now()) / 2);
      setView(v);
      setError(null);
      setLastOk(Date.now());
    } catch {
      setError("offline"); // keep showing the last picture; do not blank the screen
    }
  }, [token]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const i = setInterval(() => void load(), POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 500);
    return () => { clearTimeout(first); clearInterval(i); clearInterval(c); };
  }, [load]);

  if (error === "missing") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-10 text-center">
        <div><p className="text-3xl font-semibold">This screen is not set up</p><p className="mt-2 text-muted-foreground">Open Settings &gt; Customer screen in OrderRestro and copy this screen&rsquo;s link again.</p></div>
      </main>
    );
  }
  if (!view) return <main className="flex min-h-screen items-center justify-center bg-black text-white/60">Connecting…</main>;

  const screen = screenFor(view.state, view.stateAt, now + offset, view.terminal);
  const stale = now - lastOk > 6000;

  return (
    <main className={`relative flex min-h-screen flex-col ${screen === "ads" ? "bg-black p-0" : "bg-background p-10 text-foreground"}`} data-screen-kind={screen}>
      {screen === "ads" ? <AdLoop ads={view.ads} slide={view.terminal.adSlideSeconds} fit={view.terminal.adFit} /> : <OrderScreen state={view.state} currency={view.currency} />}
      {stale && (
        <p role="status" className="absolute bottom-3 right-3 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-black">
          Reconnecting… showing the last picture
        </p>
      )}
    </main>
  );
}

// Adverts. Mounted only while the screen is idle, so a live order replaces it in the same frame: there is nothing
// to wait for and nothing layered on top. The next picture is fetched ahead; a picture or video that fails to load
// is skipped after a moment rather than leaving a blank screen.
function AdLoop({ ads, slide, fit }: { ads: AdItem[]; slide: number; fit: "contain" | "cover" }) {
  const [i, setI] = useState(0);
  const list = ads;
  const cur = list.length ? list[i % list.length] : null;
  const next = useCallback(() => setI((v) => v + 1), []);

  useEffect(() => {
    if (!cur) return;
    if (cur.kind === "VIDEO") {
      const guard = setTimeout(next, 5 * 60_000); // a stuck video never holds the screen for more than five minutes
      return () => clearTimeout(guard);
    }
    const t = setTimeout(next, (cur.durationSec ?? slide) * 1000);
    return () => clearTimeout(t);
  }, [cur, slide, next]);

  useEffect(() => {
    // Warm the cache with the next picture.
    const n = list.length > 1 ? list[(i + 1) % list.length] : null;
    if (n && n.kind === "IMAGE") new Image().src = n.url;
  }, [i, list]);

  if (!cur) return <Welcome />;
  const cls = `h-screen w-screen ${fit === "cover" ? "object-cover" : "object-contain"}`;
  return cur.kind === "VIDEO" ? (
    <video key={cur.id + i} src={cur.url} className={cls} autoPlay muted playsInline onEnded={next} onError={() => setTimeout(next, 1500)} data-ad="video" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={cur.id + i} src={cur.url} alt={cur.title ?? ""} className={cls} onError={() => setTimeout(next, 1500)} data-ad="image" />
  );
}
