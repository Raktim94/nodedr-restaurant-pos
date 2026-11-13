"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useRatings } from "@/hooks/use-table-sessions";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default function RatingsPage() {
  const { branchId } = useBranch();
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => day(new Date()));
  const { data, isLoading, isError } = useRatings(branchId, new Date(`${from}T00:00:00`).toISOString(), new Date(`${to}T23:59:59.999`).toISOString());
  const max = Math.max(1, ...(data?.distribution ?? []).map((d) => d.count));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Customer ratings</h1>
        <p className="text-sm text-muted-foreground">Left by guests after a paid table order. One rating per order.</p>
      </div>
      <Card className="grid grid-cols-2 gap-3 p-4 sm:max-w-md">
        <div className="flex flex-col gap-1.5"><Label htmlFor="rt-from">From</Label><Input id="rt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="rt-to">To</Label><Input id="rt-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Card>
      {isLoading ? <Skeleton className="h-40 rounded-xl" /> : isError ? (
        <Card className="p-6 text-sm text-destructive">You do not have permission to view ratings, or they could not be loaded.</Card>
      ) : data && data.count > 0 ? (
        <>
          <Card className="grid gap-4 p-4 sm:grid-cols-[auto_1fr] sm:items-center">
            <div className="text-center sm:px-6"><p className="text-4xl font-semibold tabular-nums">{data.average?.toFixed(1)}</p><p className="text-sm text-muted-foreground">average of {data.count} rating{data.count === 1 ? "" : "s"}</p></div>
            <ul className="flex flex-col gap-1.5 text-sm">{[...data.distribution].reverse().map((d) => (<li key={d.stars} className="grid grid-cols-[3rem_1fr_2rem] items-center gap-2"><span>{d.stars} ★</span><span className="h-2 rounded-full bg-muted"><span className="block h-2 rounded-full bg-primary" style={{ width: `${(d.count / max) * 100}%` }} /></span><span className="text-right tabular-nums">{d.count}</span></li>))}</ul>
          </Card>
          <ul className="flex flex-col gap-2">{data.items.map((r) => (
            <li key={r.id}><Card className="flex flex-col gap-1 p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span aria-label={`${r.stars} stars`} className="font-semibold text-primary">{"★".repeat(r.stars)}<span className="text-muted-foreground">{"★".repeat(5 - r.stars)}</span></span><span className="text-muted-foreground">Order #{r.order?.orderNumber ?? "?"}{r.order?.guestName ? ` · ${r.order.guestName}` : ""} · {new Date(r.createdAt).toLocaleString()}</span></div>{r.comment && <p>{r.comment}</p>}</Card></li>))}</ul>
        </>
      ) : <Card className="py-14 text-center text-sm text-muted-foreground">No ratings in this period yet.</Card>}
    </div>
  );
}
