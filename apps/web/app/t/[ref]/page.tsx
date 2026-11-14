"use client";

import { Nfc, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface TapResult {
  accessToken: string;
  expiresAt: string;
  qrToken: string;
  tableName: string;
}

// The address written on a table's NFC tag: /t/<tag reference>?e=<encrypted tap data>&c=<MAC>. The server checks the tap;
// on success this phone keeps a short-lived proof for that table and goes to the menu. A failed check is shown plainly and
// never turned into ordinary access: the guest uses the printed QR with the staff code instead.
export default function TagTapPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params);
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<{ message: string; replay: boolean } | null>(null);

  useEffect(() => {
    if (started.current) return; // a tap is single-use: never send it twice (React may run effects twice in development)
    started.current = true;
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get("e") ?? "";
    const c = sp.get("c") ?? "";
    // Reloading the page would replay the same tap, which the server refuses. If this phone already used it, go on.
    const usedKey = `nfc-tap-used:${ref}:${c}`;
    try {
      const prior = sessionStorage.getItem(usedKey);
      if (prior) {
        router.replace(`/order/${prior}`);
        return;
      }
    } catch { /* storage blocked: carry on */ }
    api
      .get<TapResult>(`/public/nfc/tap/${encodeURIComponent(ref)}?e=${encodeURIComponent(e)}&c=${encodeURIComponent(c)}`)
      .then((r) => {
        try {
          sessionStorage.setItem(`table-access:${r.qrToken}`, r.accessToken);
          sessionStorage.setItem(usedKey, r.qrToken);
        } catch { /* storage blocked: the proof then lives only until this tab closes */ }
        router.replace(`/order/${r.qrToken}`);
      })
      .catch((err: unknown) => {
        const code = err instanceof ApiError ? err.code : undefined;
        setError({ message: err instanceof ApiError ? err.message : "Could not check this tag. Please try again.", replay: code === "NFC_REPLAY" });
      });
  }, [ref, router]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <ShieldAlert className="size-10 text-destructive" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground">{error.replay ? "Tap again" : "We could not verify this tag"}</h1>
          <p role="alert" className="text-sm text-muted-foreground">{error.message}</p>
          {!error.replay && <p className="text-sm text-muted-foreground">You can still order: scan the QR code on your table and enter the table code the staff give you.</p>}
        </>
      ) : (
        <>
          <Nfc className="size-10 animate-pulse text-primary" aria-hidden />
          <h1 className="text-xl font-semibold text-foreground">Checking your table&hellip;</h1>
          <p className="text-sm text-muted-foreground">Hold on, this takes a moment.</p>
        </>
      )}
    </main>
  );
}
