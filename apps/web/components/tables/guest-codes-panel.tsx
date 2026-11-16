"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveSessions, useSessionActions } from "@/hooks/use-table-sessions";
import { type Floor } from "@/hooks/use-tables";
import { ApiError, api } from "@/lib/api";
import { toast } from "@/lib/toast";

// The QR that guests scan to order. It changes every 30 seconds and is only valid while this table is open, so a photo
// of it stops working within a minute and a closed table's QR never works. It proves the phone saw this screen, not
// that the person is in the room: a code relayed live to someone elsewhere would still work for that minute.
function JoinQr({ branchId, tableId }: { branchId: string | null; tableId: string }) {
  const [state, setState] = useState<{ url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.get<{ token: string; qrToken: string | null; refreshInSeconds: number }>(`/tables/${tableId}/session/join-token?branchId=${branchId}`);
        if (!alive) return;
        if (!r.qrToken) { setErr("This table has no QR yet."); return; }
        setState({ url: `${window.location.origin}/order/${r.qrToken}?j=${encodeURIComponent(r.token)}` });
        setErr(null);
        timer = setTimeout(tick, Math.max(3, r.refreshInSeconds - 2) * 1000);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof ApiError ? e.message : "Could not load the QR.");
        timer = setTimeout(tick, 10_000);
      }
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [branchId, tableId]);
  if (err && !state) return <p role="alert" className="py-6 text-center text-sm text-destructive">{err}</p>;
  if (!state) return <p className="py-6 text-center text-sm text-muted-foreground">Loading QR…</p>;
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="rounded-xl bg-white p-3"><QRCodeSVG value={state.url} size={220} level="M" /></div>
      <p className="text-center text-xs text-muted-foreground">Guests scan this with their phone camera. It refreshes by itself every 30 seconds.</p>
    </div>
  );
}

// The printed QR only says which table. This is how staff let the people actually sitting there order: open the table,
// read out (or show) the 6-character code. It is shown once and cannot be looked up again; "New code" replaces it and
// stops every phone that used the old one. Paying the bill or setting the table free closes it automatically.
export function GuestCodesPanel({ branchId, floors }: { branchId: string | null; floors: Floor[] }) {
  const { data: sessions } = useActiveSessions(branchId);
  const act = useSessionActions(branchId);
  const [shown, setShown] = useState<{ tableId: string; table: string; code: string | null; expiresAt: string } | null>(null);
  const tables = floors.flatMap((f) => f.tables.map((t) => ({ ...t, floor: f.name })));
  const open = (tableId: string, number: string) =>
    act.open.mutate({ tableId }, { onSuccess: (r) => setShown({ tableId, table: number, code: r.code, expiresAt: r.expiresAt }), onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not open the table") });
  if (sessions === undefined) return null; // no permission, or loading
  return (
    <section aria-label="Guest ordering codes" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Guest ordering codes</h2>
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">Guests can look at the menu from the table QR or NFC card, but they can only order after you open the table. Open it once, then guests scan the rotating QR on your screen: nothing to read out. Paying the bill closes it.</p>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {tables.map((t) => {
            const s = sessions.find((x) => x.tableId === t.id);
            return (
              <li key={t.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <span className="min-w-0 text-sm"><b>Table {t.number}</b><span className="block text-xs text-muted-foreground">{s ? (s.locked ? "Locked after wrong codes" : `Open until ${new Date(s.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`) : "Closed"}</span></span>
                <span className="flex flex-wrap gap-1.5">
                  <Button size="sm" className="h-10" disabled={act.open.isPending} onClick={() => open(t.id, t.number)}>{s ? "Restart" : "Open table"}</Button>
                  {s && <Button size="sm" variant="outline" className="h-10" onClick={() => setShown({ tableId: t.id, table: t.number, code: null, expiresAt: s.expiresAt })}>Show QR</Button>}
                  {s && <Button size="sm" variant="outline" className="h-10" disabled={act.close.isPending} onClick={() => window.confirm(`Close Table ${t.number}? Guests there can no longer order until you open it again.`) && act.close.mutate(t.id)}>Close</Button>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Table {shown?.table} is open</DialogTitle><DialogDescription>Let guests scan this QR. Nobody needs to be told a code.</DialogDescription></DialogHeader>
          {shown && <JoinQr branchId={branchId} tableId={shown.tableId} />}
          <p className="text-center text-xs text-muted-foreground">Open until {shown ? new Date(shown.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}. Paying the bill or closing the table stops every guest phone from ordering.</p>
          {shown?.code && <p className="text-center text-xs text-muted-foreground">Fallback if a phone cannot scan: code <b className="font-mono tracking-widest" aria-label={`Code ${shown.code.split("").join(" ")}`}>{shown.code}</b> (shown only now).</p>}
          <DialogFooter><Button className="h-11 w-full" onClick={() => setShown(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
