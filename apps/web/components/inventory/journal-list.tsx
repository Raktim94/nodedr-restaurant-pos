"use client";

import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { JOURNAL_TYPES } from "@/components/inventory/journal-entry-form";
import { WASTE_REASONS } from "@/components/inventory/log-waste-dialog";
import { ProductionEntryDialog } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import {
  type JournalEntry,
  type JournalKind,
  type JournalRow,
  type JournalStatus,
  useJournalEntries,
  useJournalEntry,
  useJournalEntryActions,
  usePlaces,
  useProductionAction,
  useProductionEntry,
  csvUrl,
} from "@/hooks/use-stock-journal";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SearchSelect } from "@/components/ui/search-select";

export const KIND_LABEL: Record<JournalKind, string> = {
  PRODUCTION: "Production",
  TRANSFER: JOURNAL_TYPES.TRANSFER.short,
  WASTE: JOURNAL_TYPES.WASTE.short,
  CORRECTION: JOURNAL_TYPES.CORRECTION.short,
};
const KIND_TONE: Record<JournalKind, string> = {
  PRODUCTION: "bg-primary/10 text-primary",
  TRANSFER: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  WASTE: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  CORRECTION: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
};
export const STATUS_LABEL: Record<JournalStatus, string> = { DRAFT: "Draft", POSTED: "Posted", VOIDED: "Reversed" };
const STATUS_HELP: Record<JournalStatus, string> = {
  DRAFT: "Saved, stock not changed yet",
  POSTED: "Stock updated",
  VOIDED: "Stock put back; kept on record",
};

const dayStr = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysAgo = (n: number) => dayStr(new Date(Date.now() - n * 86_400_000));
const startOf = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOf = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);
const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const money = (v: string | null) => (v == null ? null : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function StatusBadge({ status }: { status: JournalStatus }) {
  return (
    <Badge variant={status === "POSTED" ? "default" : "outline"} title={STATUS_HELP[status]} className={cn(status === "DRAFT" && "border-dashed", status === "VOIDED" && "text-muted-foreground line-through decoration-1")}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function Lines({ lines, sign }: { lines: JournalRow["out"]; sign: "−" | "+" }) {
  if (!lines.length) return <span className="text-muted-foreground">–</span>;
  const shown = lines.slice(0, 2);
  return (
    <span className="flex flex-col">
      {shown.map((l, i) => (
        <span key={i} className="truncate"><span className={cn("tabular-nums", sign === "−" ? "text-destructive" : "text-success")}>{sign}{l.quantity} {l.unit.toLowerCase()}</span> {l.name}</span>
      ))}
      {lines.length > 2 && <span className="text-xs text-muted-foreground">+{lines.length - 2} more</span>}
    </span>
  );
}

/** Every stock journal entry in one list: production, transfers, waste and corrections, drafts and posted. */
export function JournalList({ branchId, onNew, onEdit, notice }: { branchId: string | null; onNew: () => void; onEdit: (e: JournalEntry) => void; notice?: React.ReactNode }) {
  const { data: me } = useCurrentUser();
  const canManage = hasPermission(me?.user, "inventory.manage");
  const { data: places } = usePlaces(branchId);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"" | JournalKind>("");
  const [status, setStatus] = useState<"" | JournalStatus>("");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(dayStr(new Date()));
  const [place, setPlace] = useState("");
  const [sort, setSort] = useState<{ by: "date" | "ref"; dir: "asc" | "desc" }>({ by: "date", dir: "desc" });
  const [open, setOpen] = useState<{ id: string; kind: JournalKind } | null>(null);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const filters = { q: search || undefined, type: type || undefined, status: status || undefined, from: startOf(from), to: endOf(to), locationId: place || undefined, sort: sort.by, dir: sort.dir };
  const { data: rows, isLoading, isError, isFetching, refetch } = useJournalEntries(branchId, filters);
  const filtered = !!(search || type || status || place);
  const clear = () => { setText(""); setSearch(""); setType(""); setStatus(""); setPlace(""); setFrom(daysAgo(30)); setTo(dayStr(new Date())); };
  const kinds: JournalKind[] = canManage ? ["PRODUCTION", "TRANSFER", "WASTE", "CORRECTION"] : ["PRODUCTION", "WASTE"];
  const drafts = (rows ?? []).filter((r) => r.status === "DRAFT").length;

  const ariaSort = (by: "date" | "ref") => (sort.by === by ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

  return (
    <div className="flex flex-col gap-4">
      {notice}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Label htmlFor="sj-search" className="sr-only">Search by reference or item</Label>
            <Input id="sj-search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search reference (SJ-…, PR-…) or item" className="h-10 pl-9" />
          </div>
          {filtered && <Button variant="ghost" size="sm" onClick={clear}><X aria-hidden className="size-4" /> Clear filters</Button>}
          <a href={csvUrl("journal/entries.csv", branchId, filters)} download className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Export CSV</a>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="flex flex-col gap-1"><Label htmlFor="sj-from" className="text-xs text-muted-foreground">From</Label><Input id="sj-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div className="flex flex-col gap-1"><Label htmlFor="sj-to" className="text-xs text-muted-foreground">To</Label><Input id="sj-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <div className="flex flex-col gap-1"><Label htmlFor="sj-type" className="text-xs text-muted-foreground">Type</Label>
            <SearchSelect id="sj-type" value={type} onChange={(v) => setType(v as JournalKind | "")} placeholder="All types" options={[{ value: "", label: "All types" }, ...kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))]} /></div>
          <div className="flex flex-col gap-1"><Label htmlFor="sj-status" className="text-xs text-muted-foreground">Status</Label>
            <SearchSelect id="sj-status" value={status} onChange={(v) => setStatus(v as JournalStatus | "")} placeholder="Any status" options={[{ value: "", label: "Any status" }, ...(["DRAFT", "POSTED", "VOIDED"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} /></div>
          <div className="col-span-2 flex flex-col gap-1 md:col-span-1"><Label htmlFor="sj-place" className="text-xs text-muted-foreground">Place</Label>
            <SearchSelect id="sj-place" value={place} onChange={setPlace} placeholder="All places" options={[{ value: "", label: "All places" }, ...(places ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.isActive ? undefined : "off" }))]} /></div>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground" aria-live="polite">
        <span>{rows ? `${rows.length} entr${rows.length === 1 ? "y" : "ies"}${drafts ? ` · ${drafts} draft${drafts === 1 ? "" : "s"} not posted` : ""}` : ""}{isFetching && rows ? " · updating…" : ""}</span>
        {rows && rows.length >= 300 && <span>Showing the first 300; narrow the dates to see more.</span>}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load the journal. Check the connection.
          <Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : !rows?.length ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-14 text-center">
          <p className="font-medium">{filtered ? "No entries match these filters" : "No stock journal entries in these dates"}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{filtered ? "Try another search or clear the filters." : "Record a transfer, production batch, waste or correction and it shows here."}</p>
          {filtered ? <Button size="sm" variant="outline" onClick={clear}>Clear filters</Button> : <Button size="sm" onClick={onNew}>New stock journal</Button>}
        </div>
      ) : (
        <>
          {/* Wide screens: a sortable table. */}
          <div className="hidden overflow-hidden rounded-xl border border-border md:block">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Stock journal entries</caption>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" aria-sort={ariaSort("date")} className="w-40 px-3 py-2"><SortButton by="date" sort={sort} setSort={setSort}>Date</SortButton></th>
                  <th scope="col" aria-sort={ariaSort("ref")} className="w-44 px-3 py-2"><SortButton by="ref" sort={sort} setSort={setSort}>Reference</SortButton></th>
                  <th scope="col" className="px-3 py-2 font-medium">Out of stock</th>
                  <th scope="col" className="px-3 py-2 font-medium">Into stock / destination</th>
                  <th scope="col" className="w-28 px-3 py-2 text-right font-medium">Value</th>
                  <th scope="col" className="w-24 px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={`${r.kind}:${r.id}`} className={cn("cursor-pointer align-top hover:bg-muted/40", r.status === "VOIDED" && "text-muted-foreground")} onClick={() => setOpen({ id: r.id, kind: r.kind })}>
                    <td className="px-3 py-2.5 tabular-nums">{fmtDate(r.date)}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline" onClick={(e) => { e.stopPropagation(); setOpen({ id: r.id, kind: r.kind }); }}>{r.entryNo}</button>
                      <span className={cn("mt-1 block w-fit rounded px-1.5 py-0.5 text-[11px] font-medium", KIND_TONE[r.kind])}>{KIND_LABEL[r.kind]}</span>
                    </td>
                    <td className="px-3 py-2.5"><Lines lines={r.out} sign="−" /></td>
                    <td className="px-3 py-2.5">
                      {r.kind === "TRANSFER" ? (
                        <span className="flex flex-col">{r.in.slice(0, 2).map((l, i) => <span key={i} className="flex items-center gap-1 truncate"><ArrowRight aria-hidden className="size-3.5 shrink-0" />{l.place}</span>)}</span>
                      ) : <Lines lines={r.in} sign="+" />}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(r.value) ?? <span className="text-muted-foreground">–</span>}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phones and narrow tablets: one card per entry. */}
          <ul className="flex flex-col gap-2 md:hidden">
            <li className="flex gap-2 text-xs">
              <span className="text-muted-foreground">Sort:</span>
              <SortButton by="date" sort={sort} setSort={setSort}>Date</SortButton>
              <SortButton by="ref" sort={sort} setSort={setSort}>Reference</SortButton>
            </li>
            {rows.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <button type="button" onClick={() => setOpen({ id: r.id, kind: r.kind })} className={cn("flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm active:bg-muted/50", r.status === "VOIDED" && "opacity-70")}>
                  <span className="flex w-full items-center gap-2">
                    <span className="font-semibold">{r.entryNo}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", KIND_TONE[r.kind])}>{KIND_LABEL[r.kind]}</span>
                    <span className="ml-auto"><StatusBadge status={r.status} /></span>
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDate(r.date)}{r.places.length ? ` · ${r.places.join(", ")}` : ""}</span>
                  <span className="grid grid-cols-2 gap-2">
                    <Lines lines={r.out} sign="−" />
                    {r.kind === "TRANSFER" ? <span className="text-muted-foreground">to {[...new Set(r.in.map((l) => l.place))].join(", ")}</span> : <Lines lines={r.in} sign="+" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && open.kind !== "PRODUCTION" && <JournalDetails branchId={branchId} id={open.id} onClose={() => setOpen(null)} onEdit={(e) => { setOpen(null); onEdit(e); }} />}
      {open && open.kind === "PRODUCTION" && <ProductionDetails branchId={branchId} id={open.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

type Sort = { by: "date" | "ref"; dir: "asc" | "desc" };
function SortButton({ by, sort, setSort, children }: { by: Sort["by"]; sort: Sort; setSort: (f: (s: Sort) => Sort) => void; children: React.ReactNode }) {
  const active = sort.by === by;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button type="button" className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }))}>
      {children}<Icon aria-hidden className={cn("size-3.5", !active && "opacity-50")} />
    </button>
  );
}

// ---- details ---------------------------------------------------------------------------------------------

function Audit({ rows }: { rows: [string, string | null | undefined, string | null | undefined][] }) {
  return (
    <section aria-label="Audit trail">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit trail</h3>
      <ol className="flex flex-col gap-2 border-l border-border pl-4 text-sm">
        {rows.filter(([, at]) => at).map(([what, at, who]) => (
          <li key={what}><span className="font-medium">{what}</span> <span className="text-muted-foreground">{fmtDate(at!)}{who ? ` by ${who}` : ""}</span></li>
        ))}
      </ol>
    </section>
  );
}

function ReverseDialog({ title, description, open, onClose, onConfirm, pending, error }: { title: string; description: string; open: boolean; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rev-reason">Reason (required)</Label>
          <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500} placeholder="e.g. Entered on the wrong item" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Keep it</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || pending} onClick={() => onConfirm(reason.trim())}>{pending ? "Reversing…" : "Reverse entry"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JournalDetails({ branchId, id, onClose, onEdit }: { branchId: string | null; id: string; onClose: () => void; onEdit: (e: JournalEntry) => void }) {
  const { data: me } = useCurrentUser();
  const canReverse = hasPermission(me?.user, "production.void");
  const { data: e, isLoading, isError } = useJournalEntry(branchId, id);
  const act = useJournalEntryActions(branchId);
  const [dialog, setDialog] = useState<"post" | "delete" | "void" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fail = (er: unknown) => setError(er instanceof ApiError ? er.message : "That did not work. Nothing was changed.");
  const busy = act.post.isPending || act.remove.isPending || act.void.isPending;
  const typeMeta = e ? JOURNAL_TYPES[e.type] : null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">{e?.entryNo ?? "Loading…"}{e && <StatusBadge status={e.status} />}</SheetTitle>
          <SheetDescription>{typeMeta ? `${typeMeta.label}. ${STATUS_HELP[e!.status]}.` : " "}</SheetDescription>
        </SheetHeader>
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-32" /></div>
        ) : isError || !e ? (
          <p role="alert" className="p-4 text-sm text-destructive">Could not load this entry.</p>
        ) : (
          <div className="flex flex-col gap-5 p-4">
            {done && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{done}</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Date and time</dt><dd>{fmtDate(e.occurredAt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Value at average cost</dt><dd className="tabular-nums">{e.type === "TRANSFER" ? "No change" : (money(e.value) ?? (e.status === "DRAFT" ? "Worked out when posted" : "Not available"))}</dd></div>
              {e.reason && <div className="col-span-2"><dt className="text-xs text-muted-foreground">{e.type === "CORRECTION" ? "Reason" : "Purpose"}</dt><dd>{e.reason}</dd></div>}
              {e.notes && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{e.notes}</dd></div>}
              {e.voidReason && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Reversed because</dt><dd>{e.voidReason}</dd></div>}
            </dl>
            <section aria-label="Stock movement">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock movement</h3>
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {e.lines.map((l) => (
                  <li key={l.id} className="flex flex-col gap-1 px-3 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 font-medium">{l.ingredient.name}</span>
                      <span className={cn("tabular-nums", e.type === "TRANSFER" ? "" : l.direction === "OUT" ? "text-destructive" : "text-success")}>{e.type === "TRANSFER" ? "" : l.direction === "OUT" ? "−" : "+"}{l.enteredQuantity} {l.enteredUnit.toLowerCase()}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {e.type === "TRANSFER" && <span className="flex items-center gap-1">{l.fromLocationName ?? "Not yet placed"} <ArrowRight aria-label="to" className="size-3" /> {l.toLocationName}</span>}
                      {e.type !== "TRANSFER" && (l.fromLocationName || l.toLocationName) && <span>{l.direction === "OUT" ? `from ${l.fromLocationName}` : `into ${l.toLocationName}`}</span>}
                      {l.wasteReason && <span>{WASTE_REASONS.find((w) => w.value === l.wasteReason)?.label}</span>}
                      {l.enteredUnit !== l.ingredient.unit && <span>= {l.quantity} {l.ingredient.unit.toLowerCase()}</span>}
                      {l.value && <span className="tabular-nums">{money(l.value)}</span>}
                      {l.wasteStatus && l.wasteStatus !== "POSTED" && <span className="font-medium text-warning">Waste record: {l.wasteStatus === "PENDING_APPROVAL" ? "needs manager approval" : l.wasteStatus.toLowerCase()}</span>}
                    </div>
                    {l.note && <p className="text-xs">{l.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
            <Audit rows={[["Created", e.createdAt, e.createdByName], ["Posted", e.postedAt, e.postedByName], ["Reversed", e.voidedAt, e.voidedByName]]} />
            {error && !dialog && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <div className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap gap-2 border-t border-border bg-popover px-4 py-3">
              {e.status === "DRAFT" && (
                <>
                  <Button onClick={() => { setError(null); setDialog("post"); }}>Post journal</Button>
                  <Button variant="outline" onClick={() => onEdit(e)}>Edit draft</Button>
                  <Button variant="ghost" className="text-destructive" onClick={() => { setError(null); setDialog("delete"); }}>Delete draft</Button>
                </>
              )}
              {e.status === "POSTED" && canReverse && <Button variant="outline" className="text-destructive" onClick={() => { setError(null); setDialog("void"); }}>Reverse entry</Button>}
              {e.status === "POSTED" && !canReverse && <p className="text-xs text-muted-foreground">Posted entries cannot be edited. Ask a manager to reverse it if it is wrong.</p>}
            </div>
          </div>
        )}
      </SheetContent>

      {e && (
        <>
          <Dialog open={dialog === "post"} onOpenChange={(o) => !o && !busy && setDialog(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Post {e.entryNo}?</DialogTitle><DialogDescription>Stock is updated now. After posting the entry cannot be edited; a manager can reverse it.</DialogDescription></DialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>Not yet</Button>
                <Button autoFocus disabled={busy} onClick={() => act.post.mutate(e.id, { onSuccess: () => { setDialog(null); setDone(`${e.entryNo} posted. Stock is updated.`); }, onError: fail })}>{busy ? "Posting…" : "Post and update stock"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && !busy && setDialog(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Delete draft {e.entryNo}?</DialogTitle><DialogDescription>The draft never changed stock, so nothing else changes. This cannot be undone.</DialogDescription></DialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>Keep it</Button>
                <Button variant="destructive" disabled={busy} onClick={() => act.remove.mutate(e.id, { onSuccess: onClose, onError: fail })}>{busy ? "Deleting…" : "Delete draft"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ReverseDialog
            open={dialog === "void"}
            title={`Reverse ${e.entryNo}?`}
            description={e.type === "TRANSFER" ? "The stock moves back to where it came from. The entry stays on record as reversed." : "Every stock change in this entry is put back. The entry stays on record as reversed."}
            pending={busy}
            error={error}
            onClose={() => setDialog(null)}
            onConfirm={(reason) => act.void.mutate({ id: e.id, reason }, { onSuccess: () => { setDialog(null); setDone(`${e.entryNo} reversed. Stock was put back.`); }, onError: fail })}
          />
        </>
      )}
    </Sheet>
  );
}

function ProductionDetails({ branchId, id, onClose }: { branchId: string | null; id: string; onClose: () => void }) {
  const { data: me } = useCurrentUser();
  const canReverse = hasPermission(me?.user, "production.void");
  const canPost = hasPermission(me?.user, "production.post");
  const { data: e, isLoading, isError } = useProductionEntry(branchId, id);
  const act = useProductionAction(branchId);
  const [dialog, setDialog] = useState<"post" | "void" | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fail = (er: unknown) => setError(er instanceof ApiError ? er.message : "That did not work. Nothing was changed.");

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">{e?.entryNo ?? "Loading…"}{e && <StatusBadge status={e.status} />}</SheetTitle>
          <SheetDescription>Production: ingredients used and products made.</SheetDescription>
        </SheetHeader>
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-32" /></div>
        ) : isError || !e ? (
          <p role="alert" className="p-4 text-sm text-destructive">Could not load this entry.</p>
        ) : (
          <div className="flex flex-col gap-5 p-4">
            {done && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{done}</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Made at</dt><dd>{fmtDate(e.producedAt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Batch cost</dt><dd className="tabular-nums">{money(e.totalCost) ?? "Not costed"}</dd></div>
              {(e.shift || e.location) && <div><dt className="text-xs text-muted-foreground">Shift / place</dt><dd>{[e.shift, e.location].filter(Boolean).join(" · ")}</dd></div>}
              {e.batchRef && <div><dt className="text-xs text-muted-foreground">Batch ref.</dt><dd>{e.batchRef}</dd></div>}
              {e.notes && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Narration</dt><dd>{e.notes}</dd></div>}
              {e.voidReason && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Reversed because</dt><dd>{e.voidReason}</dd></div>}
              {e.correctsEntry && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Corrects</dt><dd>{e.correctsEntry.entryNo}</dd></div>}
              {e.correctedBy.length > 0 && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Replaced by</dt><dd>{e.correctedBy.map((c) => c.entryNo).join(", ")}</dd></div>}
            </dl>
            {(["INPUT", "OUTPUT"] as const).map((role) => (
              <section key={role} aria-label={role === "INPUT" ? "Consumed" : "Produced"}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{role === "INPUT" ? "Consumed (out of stock)" : "Produced (into stock)"}</h3>
                <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                  {e.lines.filter((l) => l.role === role).map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2.5">
                      <span className="min-w-0 flex-1 font-medium">{l.ingredient.name}{l.locationName && <span className="block text-xs font-normal text-muted-foreground">{role === "INPUT" ? "from" : "into"} {l.locationName}</span>}</span>
                      <span className={cn("tabular-nums", role === "INPUT" ? "text-destructive" : "text-success")}>{role === "INPUT" ? "−" : "+"}{l.enteredQuantity} {l.enteredUnit.toLowerCase()}</span>
                      {role === "OUTPUT" && Number(l.rejectedQuantity) > 0 && <span className="w-full text-xs text-muted-foreground">{l.rejectedQuantity} rejected (not stocked)</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <Audit rows={[["Created", e.createdAt, null], ["Posted", e.postedAt, null], ["Reversed", e.voidedAt, null]]} />
            {e.responsibleName && <p className="-mt-3 text-xs text-muted-foreground">Responsible: {e.responsibleName}</p>}
            {error && !dialog && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap gap-2 border-t border-border bg-popover px-4 py-3">
              {e.status === "DRAFT" && canPost && <Button onClick={() => { setError(null); setDialog("post"); }}>Post journal</Button>}
              {e.status === "DRAFT" && !canPost && <p className="text-xs text-muted-foreground">Posting a production draft needs the post permission.</p>}
              {e.status === "POSTED" && canReverse && (
                <>
                  <Button variant="outline" onClick={() => setCorrecting(true)}>Correct</Button>
                  <Button variant="outline" className="text-destructive" onClick={() => { setError(null); setDialog("void"); }}>Reverse entry</Button>
                </>
              )}
            </div>
          </div>
        )}
      </SheetContent>
      {e && (
        <>
          <Dialog open={dialog === "post"} onOpenChange={(o) => !o && !act.isPending && setDialog(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Post {e.entryNo}?</DialogTitle><DialogDescription>Ingredients leave stock and the products made enter stock now.</DialogDescription></DialogHeader>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)} disabled={act.isPending}>Not yet</Button>
                <Button autoFocus disabled={act.isPending} onClick={() => act.mutate({ id: e.id, action: "post" }, { onSuccess: () => { setDialog(null); setDone(`${e.entryNo} posted. Stock is updated.`); }, onError: fail })}>{act.isPending ? "Posting…" : "Post and update stock"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <ReverseDialog
            open={dialog === "void"}
            title={`Reverse ${e.entryNo}?`}
            description="The ingredients go back into stock and the products made come out. The entry stays on record as reversed."
            pending={act.isPending}
            error={error}
            onClose={() => setDialog(null)}
            onConfirm={(reason) => act.mutate({ id: e.id, action: "void", body: { reason } }, { onSuccess: () => { setDialog(null); setDone(`${e.entryNo} reversed. Stock was put back.`); }, onError: fail })}
          />
          {correcting && <ProductionEntryDialog key={e.id} branchId={branchId} open correcting={e} onOpenChange={(o) => { if (!o) setCorrecting(false); }} />}
        </>
      )}
    </Sheet>
  );
}
