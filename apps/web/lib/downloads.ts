import type { DownloadStat } from "@/hooks/use-download-stats";

export function totalDownloads(stats: DownloadStat[] | undefined): number {
  if (!stats) return 0;
  return stats.reduce((sum, s) => sum + s.count, 0);
}

// The real download URL for a channel — used as the link's destination so
// it still works via a normal redirect even without JS; the count
// increments server-side on the actual click-through, not via client fetch.
// A plain, server-and-client-safe helper (no hooks, no browser APIs) — kept
// out of hooks/use-download-stats.ts (a "use client" module) so Server
// Components can call it directly without a client-boundary violation.
export function downloadHref(channel: string): string {
  return `/api/v1/downloads/go/${channel}`;
}
