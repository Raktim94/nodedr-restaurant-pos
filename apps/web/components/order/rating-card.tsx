"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

// Shown only on the phone that placed an order, after it is paid. The token was handed to this phone when it ordered;
// the server decides whether the order is rated-eligible. A visitor who only scanned the QR never sees this.
export function RatingCard({ orderId }: { orderId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "eligible" | "hidden" | "done">("loading");
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let t: string | null = null;
    try { t = localStorage.getItem(`rating-token:${orderId}`); } catch { /* storage blocked */ }
    if (!t) { const h = setTimeout(() => setState("hidden"), 0); return () => clearTimeout(h); }
    const tok = t;
    const h = setTimeout(() => setToken(tok), 0);
    api.get<{ eligible: boolean; rated: boolean }>(`/public/ratings/status?token=${encodeURIComponent(tok)}`)
      .then((s) => setState(s.eligible ? "eligible" : s.rated ? "done" : "hidden"))
      .catch(() => setState("hidden"));
    return () => clearTimeout(h);
  }, [orderId]);

  if (state === "loading" || state === "hidden") return null;
  if (state === "done") return <p className="mb-4 rounded-2xl border border-border p-4 text-sm">Thank you for your feedback.</p>;

  const submit = async () => {
    if (!token || stars < 1) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/public/ratings", { token, stars, comment: comment.trim() || undefined });
      setState("done");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not send your rating. Please try again.");
      if (e instanceof ApiError && e.status === 409) setState("done");
    }
    setBusy(false);
  };

  return (
    <section aria-label="Rate your visit" className="mb-4 rounded-2xl border border-border p-4">
      <h3 className="text-sm font-semibold">How was your visit?</h3>
      <div role="radiogroup" aria-label="Stars" className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setStars(n)} className={`size-12 rounded-xl border text-2xl ${stars >= n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>★</button>
        ))}
      </div>
      <label className="mt-3 block text-xs text-muted-foreground" htmlFor="rating-comment">Comment (optional)</label>
      <textarea id="rating-comment" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 500))} rows={3} maxLength={500} className="mt-1 w-full rounded-xl border border-input bg-background p-2 text-base" />
      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
      <Button className="mt-3 h-12 w-full" disabled={busy || stars < 1} onClick={() => void submit()}>{busy ? "Sending…" : "Send rating"}</Button>
    </section>
  );
}
