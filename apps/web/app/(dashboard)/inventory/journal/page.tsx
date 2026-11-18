"use client";

import type { StockJournalType } from "@nodedr-restaurant/types";
import { ArrowLeftRight, ChefHat, ClipboardCheck, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { JOURNAL_TYPES, JournalEntryForm } from "@/components/inventory/journal-entry-form";
import { JournalList } from "@/components/inventory/journal-list";
import { ManufacturingReportsView } from "@/components/inventory/manufacturing-reports-view";
import { MovementsView } from "@/components/inventory/movements-view";
import { StockJournalVoucher } from "@/components/inventory/stock-journal-voucher";
import { Button } from "@/components/ui/button";
import { StatusNote, useStatusNote } from "@/components/ui/status-note";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { Skeleton } from "@/components/ui/skeleton";
import { type JournalEntry, useProductionEntry } from "@/hooks/use-stock-journal";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "journal", label: "Journal" },
  { id: "new", label: "New entry" },
  { id: "report", label: "Production report" },
  { id: "movements", label: "Stock movements" },
] as const;
type View = (typeof VIEWS)[number]["id"];
type NewType = "PRODUCTION" | StockJournalType;

const PICK: { type: NewType; label: string; help: string; Icon: typeof ChefHat; needsManage: boolean }[] = [
  { type: "TRANSFER", label: JOURNAL_TYPES.TRANSFER.label, help: JOURNAL_TYPES.TRANSFER.help, Icon: ArrowLeftRight, needsManage: true },
  { type: "PRODUCTION", label: "Production or preparation", help: "Ingredients used up and the dish, sauce or batch they made. Stock of each moves together.", Icon: ChefHat, needsManage: false },
  { type: "WASTE", label: JOURNAL_TYPES.WASTE.label, help: JOURNAL_TYPES.WASTE.help, Icon: Trash2, needsManage: false },
  { type: "CORRECTION", label: JOURNAL_TYPES.CORRECTION.label, help: JOURNAL_TYPES.CORRECTION.help, Icon: ClipboardCheck, needsManage: true },
];

function JournalShell() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canManage = hasPermission(me?.user, "journal.manage");
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("view");
  // Old links: ?view=voucher (the voucher) and ?view=entries (production entries) still land somewhere sensible.
  const view: View = raw === "voucher" ? "new" : raw === "entries" ? "journal" : VIEWS.some((v) => v.id === raw) ? (raw as View) : "journal";
  const rawType = params.get("type") ?? (raw === "voucher" ? "PRODUCTION" : null);
  const newType = PICK.find((p) => p.type === rawType && (canManage || !p.needsManage))?.type ?? null;
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  // A production draft being reopened (production entries are a different record from the other journal kinds).
  const [editingProd, setEditingProd] = useState<string | null>(null);
  const { data: prodDraft, isLoading: prodLoading, isError: prodError } = useProductionEntry(branchId, editingProd);
  const [formKey, setFormKey] = useState(0);
  const { note, show, clear } = useStatusNote(15_000);

  const go = (id: View, type?: NewType | null) => {
    const q = new URLSearchParams();
    if (id !== "journal") q.set("view", id);
    if (type) q.set("type", type);
    const s = q.toString();
    router.replace(s ? `/inventory/journal?${s}` : "/inventory/journal", { scroll: false });
  };
  const saved = (entryNo: string, posted: boolean) => {
    setEditing(null);
    setEditingProd(null);
    setFormKey((n) => n + 1);
    show("success", posted ? `${entryNo} posted. Stock is updated.` : `${entryNo} saved as a draft. Stock has not changed; post it from the journal when ready.`);
    go("journal");
  };
  const formType: NewType | null = editing ? editing.type : newType;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock, daily production, purchasing, and food waste</p>
        </div>
        {view !== "new" && <Button onClick={() => { setEditing(null); setEditingProd(null); go("new"); }}>New stock journal</Button>}
      </div>
      <InventoryTabs />
      <div role="tablist" aria-label="Stock journal views" className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-fit">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={view === v.id}
            onClick={() => { if (v.id === "new") { setEditing(null); setEditingProd(null); } go(v.id); }}
            className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50", view === v.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "journal" && (
        <JournalList
          branchId={branchId}
          onNew={() => go("new")}
          onEdit={(e) => { setEditing(e); setEditingProd(null); go("new", e.type); }}
          onEditProduction={(id) => { setEditing(null); setEditingProd(id); go("new", "PRODUCTION"); }}
          notice={<StatusNote note={note} onClear={clear} />}
        />
      )}

      {view === "new" && !formType && (
        <section aria-labelledby="pick-title" className="flex flex-col gap-3">
          <div>
            <h2 id="pick-title" className="text-lg font-semibold">What do you want to record?</h2>
            <p className="text-sm text-muted-foreground">Each kind moves stock differently, so pick the one that matches what happened. Nothing changes until you post.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {PICK.filter((p) => canManage || !p.needsManage).map((p) => (
              <li key={p.type}>
                <button type="button" onClick={() => go("new", p.type)} className="flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="rounded-lg bg-muted p-2"><p.Icon aria-hidden className="size-5" /></span>
                  <span><span className="block font-medium">{p.label}</span><span className="mt-0.5 block text-sm text-muted-foreground">{p.help}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "new" && formType && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{editing || prodDraft ? `Edit draft ${(editing ?? prodDraft)!.entryNo}` : `New ${formType === "PRODUCTION" ? "production entry" : JOURNAL_TYPES[formType].label.toLowerCase()}`}</h2>
            {!editing && !editingProd && <Button variant="ghost" size="sm" onClick={() => go("new")}>Change type</Button>}
          </div>
          {formType === "PRODUCTION" && editingProd && (prodLoading || prodError || !prodDraft) ? (
            prodError ? <p role="alert" className="text-sm text-destructive">Could not load that draft. Nothing was changed.</p> : <Skeleton className="h-64 rounded-xl" />
          ) : formType === "PRODUCTION" ? (
            <StockJournalVoucher
              key={`p-${formKey}-${prodDraft?.id ?? "new"}`}
              draft={prodDraft?.status === "DRAFT" ? prodDraft : undefined}
              inline
              branchId={branchId}
              open
              onSaved={(r) => saved(r.entryNo, r.posted)}
              onOpenChange={(o) => { if (!o) setFormKey((n) => n + 1); }}
            />
          ) : (
            <JournalEntryForm
              key={`${formType}-${editing?.id ?? "new"}-${formKey}`}
              branchId={branchId}
              type={formType}
              draft={editing ?? undefined}
              onDone={(e, posted) => saved(e.entryNo, posted)}
              onCancel={() => { setEditing(null); go("journal"); }}
            />
          )}
        </div>
      )}

      {view === "report" && <ManufacturingReportsView embedded />}
      {view === "movements" && <MovementsView />}
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={null}>
      <JournalShell />
    </Suspense>
  );
}
