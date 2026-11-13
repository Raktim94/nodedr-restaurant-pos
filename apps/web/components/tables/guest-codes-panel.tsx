"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveSessions, useSessionActions } from "@/hooks/use-table-sessions";
import { type Floor } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

// The printed QR only says which table. This is how staff let the people actually sitting there order: open the table,
// read out (or show) the 6-character code. It is shown once and cannot be looked up again; "New code" replaces it and
// stops every phone that used the old one. Paying the bill or setting the table free closes it automatically.
export function GuestCodesPanel({ branchId, floors }: { branchId: string | null; floors: Floor[] }) {
  const { data: sessions } = useActiveSessions(branchId);
  const act = useSessionActions(branchId);
  const [shown, setShown] = useState<{ table: string; code: string; expiresAt: string } | null>(null);
  const tables = floors.flatMap((f) => f.tables.map((t) => ({ ...t, floor: f.name })));
  const open = (tableId: string, number: string) =>
    act.open.mutate({ tableId }, { onSuccess: (r) => setShown({ table: number, code: r.code, expiresAt: r.expiresAt }), onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not open the table") });
  if (sessions === undefined) return null; // no permission, or loading
  return (
    <section aria-label="Guest ordering codes" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Guest ordering codes</h2>
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">Guests can look at the menu from the table QR or NFC card, but they can only order after you open the table and give them its code. Paying the bill closes it.</p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => {
            const s = sessions.find((x) => x.tableId === t.id);
            return (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                <span className="text-sm"><b>Table {t.number}</b><span className="block text-xs text-muted-foreground">{s ? (s.locked ? "Locked after wrong codes" : `Open until ${new Date(s.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`) : "Closed"}</span></span>
                <span className="flex gap-1.5">
                  <Button size="sm" className="h-10" disabled={act.open.isPending} onClick={() => open(t.id, t.number)}>{s ? "New code" : "Open"}</Button>
                  {s && <Button size="sm" variant="outline" className="h-10" disabled={act.close.isPending} onClick={() => window.confirm(`Close Table ${t.number}? Guests there can no longer order until you open it again.`) && act.close.mutate(t.id)}>Close</Button>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Table {shown?.table} is open</DialogTitle><DialogDescription>Give guests this code. It is shown only now.</DialogDescription></DialogHeader>
          <p className="py-4 text-center font-mono text-5xl font-semibold tracking-[0.25em]" aria-label={`Code ${shown?.code.split("").join(" ")}`}>{shown?.code}</p>
          <p className="text-center text-xs text-muted-foreground">Valid until {shown ? new Date(shown.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}. If you lose it, press New code.</p>
          <DialogFooter><Button className="h-11 w-full" onClick={() => setShown(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
