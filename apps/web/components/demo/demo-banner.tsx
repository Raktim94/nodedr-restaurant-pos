"use client";

import { useDemoInfo } from "@/hooks/use-demo";

// Only the public demo server shows this. Visitors are told plainly that nothing here is real and when it resets.
export function DemoBanner() {
  const { data } = useDemoInfo();
  if (!data?.demo) return null;
  const at = data.nextResetAt ? new Date(data.nextResetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground">
      <span>Live demo: sample data only, nothing is real.</span>
      <span className="opacity-90">Everything resets every {data.resetEveryHours} hours{at ? ` (next about ${at})` : ""}. Some admin features are switched off.</span>
      <a href="https://orderrestro.nodedr.com/" className="underline">Get OrderRestro</a>
    </div>
  );
}
