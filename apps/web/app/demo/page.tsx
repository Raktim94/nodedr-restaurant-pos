"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

// https://orderrestro-demo.nodedrdev.com/demo : one click in, no sign-up and no password. Works only on the demo server.
export default function DemoEntry() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.post("/auth/demo-login")
      .then(() => { if (live) router.replace("/dashboard"); })
      .catch((e) => { if (live) setError(e instanceof ApiError && e.status === 404 ? "This server is not the public demo." : e instanceof ApiError ? e.message : "The demo could not start. Please try again in a minute."); });
    return () => { live = false; };
  }, [router]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      {error ? (
        <div><p className="text-lg font-semibold">{error}</p><a className="mt-3 inline-block underline" href="/demo">Try again</a></div>
      ) : (
        <div><p className="text-lg font-semibold">Opening the OrderRestro demo…</p><p className="mt-1 text-sm text-muted-foreground">No sign-up. No password.</p></div>
      )}
    </main>
  );
}
