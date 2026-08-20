"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Live "how long has this table been in its current state" badge — counts
 * up from `statusSince` (set server-side the moment a table's status last
 * changed, see Table.statusSince in schema.prisma). Ticks once a minute:
 * a floor/POS glance doesn't need second-level precision, and a slower
 * interval means many tiles on screen at once don't all restart timers
 * needlessly often.
 */
export function ElapsedTimer({ since, className }: { since: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - new Date(since).getTime();

  return (
    <span className={className}>
      <Clock className="h-3 w-3" />
      {formatElapsed(elapsed)}
    </span>
  );
}
