"use client";

import { KeyRound, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useActiveSessions, useSessionActions } from "@/hooks/use-table-sessions";
import { type Floor } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// The printed QR only says which table. This is how staff let the people actually sitting there order: open the table,
// read out (or show) the 6-character code. It is shown once and cannot be looked up again; "New code" replaces it and
// stops every phone that used the old one. Paying the bill or setting the table free closes it automatically.
export function GuestCodesPanel({ branchId, floors }: { branchId: string | null; floors: Floor[] }) {
  const { data: sessions } = useActiveSessions(branchId);
  const act = useSessionActions(branchId);
  const [shown, setShown] = useState<{ table: string; code: string; expiresAt: string } | null>(null);
  const [confirmCloseTable, setConfirmCloseTable] = useState<{ id: string; number: string } | null>(null);
  const tables = floors.flatMap((f) => f.tables.map((t) => ({ ...t, floor: f.name })));
  
  const open = (tableId: string, number: string) =>
    act.open.mutate(
      { tableId },
      {
        onSuccess: (r) => setShown({ table: number, code: r.code, expiresAt: r.expiresAt }),
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not open the table"),
      },
    );

  const handleCloseSession = () => {
    if (!confirmCloseTable) return;
    act.close.mutate(confirmCloseTable.id, {
      onSuccess: () => {
        toast.success(`Table ${confirmCloseTable.number} ordering closed`);
        setConfirmCloseTable(null);
      },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not close the table"),
    });
  };

  if (sessions === undefined) return null; // no permission, or loading

  return (
    <section aria-label="Guest ordering codes" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
          <KeyRound className="h-4 w-4 text-primary" />
          Guest ordering codes
        </h2>
        <span className="text-xs text-muted-foreground font-medium">
          {sessions.length} open {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>

      <Card className="flex flex-col gap-3 p-3.5 sm:p-4 border border-border/80 bg-card shadow-xs">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Guests can scan the table QR to view the menu, but need an active staff code to place orders.
        </p>

        <ul className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1 scrollbar-none">
          {tables.map((t) => {
            const s = sessions.find((x) => x.tableId === t.id);
            const isOpen = !!s;
            return (
              <li
                key={t.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-colors",
                  isOpen
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/70 bg-card hover:bg-secondary/40",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs sm:text-sm font-bold text-foreground">
                      Table {t.number}
                    </span>
                    {t.name && (
                      <span className="text-[11px] text-muted-foreground truncate">
                        ({t.name})
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5">
                    {s ? (
                      s.locked ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-destructive">
                          <ShieldAlert className="h-3 w-3" /> Locked (wrong codes)
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-primary">
                          Open until {new Date(s.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Closed</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    className={cn(
                      "h-8 px-2.5 text-xs font-semibold rounded-lg shadow-xs active:scale-95 transition-all",
                      isOpen ? "bg-primary text-white" : "",
                    )}
                    disabled={act.open.isPending}
                    onClick={() => open(t.id, t.number)}
                  >
                    {isOpen ? "New code" : "Open"}
                  </Button>
                  {isOpen && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive rounded-lg active:scale-95"
                      disabled={act.close.isPending}
                      onClick={() => setConfirmCloseTable({ id: t.id, number: t.number })}
                    >
                      Close
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Confirmation Dialog using shadcn Dialog */}
      <Dialog open={!!confirmCloseTable} onOpenChange={(o) => !o && setConfirmCloseTable(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl p-5 border border-border shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">
              Close Table {confirmCloseTable?.number}?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Guests sitting at Table {confirmCloseTable?.number} will no longer be able to submit orders from their phones until you open the table again.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4 flex flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-xl text-xs font-semibold"
              onClick={() => setConfirmCloseTable(null)}
              disabled={act.close.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9 rounded-xl text-xs font-semibold shadow-xs"
              onClick={handleCloseSession}
              disabled={act.close.isPending}
            >
              {act.close.isPending ? "Closing…" : "Close table"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-sm rounded-2xl p-5 border border-border shadow-xl">
          <DialogHeader className="text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-1">
              <Sparkles className="h-5 w-5" />
            </div>
            <DialogTitle className="text-lg font-bold">Table {shown?.table} is open</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Share this 6-character code with guests at the table.
            </DialogDescription>
          </DialogHeader>

          <div className="my-3 rounded-2xl border border-primary/30 bg-primary/5 py-4 text-center">
            <p
              className="font-mono text-4xl sm:text-5xl font-extrabold tracking-[0.22em] text-foreground"
              aria-label={`Code ${shown?.code.split("").join(" ")}`}
            >
              {shown?.code}
            </p>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Valid until {shown ? new Date(shown.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}. You can generate a new code anytime.
          </p>

          <DialogFooter className="mt-2">
            <Button className="h-10 w-full rounded-xl font-bold shadow-xs" onClick={() => setShown(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
