"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const err = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");
const thisMonth = () => new Date().toISOString().slice(0, 7);

/* ----------------------------- Budgets ----------------------------- */

interface BudgetView {
  month: string;
  rows: { id: string; category: string; budget: number; actual: number; remaining: number; percentUsed: number }[];
  unbudgeted: { category: string; actual: number }[];
  totalBudget: number;
  totalActual: number;
  remaining: number;
}

export function BudgetsTab({ branchId }: { branchId: string | null }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const key = ["acct", "budgets", branchId, month];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<BudgetView>(`/accounting/budgets?branchId=${branchId}&month=${month}`),
    enabled: !!branchId,
  });
  const save = useMutation({
    mutationFn: (dto: { month: string; category: string; amount: number }) =>
      api.put(`/accounting/budgets?branchId=${branchId}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acct", "budgets"] });
      setCategory("");
      setAmount("");
      toast.success("Budget saved");
    },
    onError: (e) => toast.error(err(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/accounting/budgets/${id}?branchId=${branchId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acct", "budgets"] }),
    onError: (e) => toast.error(err(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="bud-month">Month</label>
          <Input id="bud-month" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="bud-cat">Expense category</label>
          <Input id="bud-cat" className="w-48" placeholder="e.g. Rent, Utilities" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="bud-amt">Budget</label>
          <Input id="bud-amt" type="number" min="0" step="0.01" className="w-36" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button
          disabled={!category.trim() || !amount || save.isPending}
          onClick={() => save.mutate({ month, category: category.trim(), amount: Number(amount) })}
        >
          Set budget
        </Button>
      </Card>

      <Card className="overflow-x-auto p-4">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : data && data.rows.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1">Category</th><th>Budget</th><th>Spent</th><th>Left</th><th className="w-40">Used</th><th /></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1.5">{r.category}</td>
                    <td className="tabular-nums">{formatCurrency(r.budget)}</td>
                    <td className="tabular-nums">{formatCurrency(r.actual)}</td>
                    <td className={cn("tabular-nums", r.remaining < 0 && "text-destructive")}>{formatCurrency(r.remaining)}</td>
                    <td>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={r.percentUsed} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.category} budget used`}>
                        <div
                          className={cn("h-full rounded-full", r.percentUsed > 100 ? "bg-destructive" : r.percentUsed >= 80 ? "bg-amber-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, r.percentUsed)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{r.percentUsed}%</span>
                    </td>
                    <td className="text-right">
                      <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(r.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="tabular-nums">{formatCurrency(data.totalBudget)}</td>
                  <td className="tabular-nums">{formatCurrency(data.totalActual)}</td>
                  <td className={cn("tabular-nums", data.remaining < 0 && "text-destructive")}>{formatCurrency(data.remaining)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
            {data.unbudgeted.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Spending with no budget: {data.unbudgeted.map((u) => `${u.category} (${formatCurrency(u.actual)})`).join(", ")}
              </p>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No budgets for {month}. Set one above to track spending against it.</p>
        )}
      </Card>
    </div>
  );
}

/* --------------------------- Bank reconciliation --------------------------- */

interface BankView {
  summary: { total: number; matched: number; unmatched: number; ignored: number; moneyIn: number; moneyOut: number };
  transactions: {
    id: string;
    postedOn: string;
    description: string;
    reference: string;
    amount: number;
    status: "UNMATCHED" | "MATCHED" | "IGNORED";
    expense: { id: string; category: string; note: string | null; spentOn: string } | null;
  }[];
}
interface Candidate { id: string; category: string; amount: string; spentOn: string; note: string | null }

export function BankTab({ branchId }: { branchId: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["acct", "bank", branchId],
    queryFn: () => api.get<BankView>(`/accounting/bank?branchId=${branchId}`),
    enabled: !!branchId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["acct", "bank"] });
  const importCsv = useMutation({
    mutationFn: (csv: string) =>
      api.post<{ imported: number; duplicatesIgnored: number; autoMatched: number; skippedLines: number[] }>(
        `/accounting/bank/import?branchId=${branchId}`,
        { csv },
      ),
    onSuccess: (r) => {
      refresh();
      toast.success(
        `Imported ${r.imported} line(s), matched ${r.autoMatched}` +
          (r.duplicatesIgnored ? `, ${r.duplicatesIgnored} already imported` : "") +
          (r.skippedLines.length ? `, ${r.skippedLines.length} unreadable` : ""),
      );
    },
    onError: (e) => toast.error(err(e)),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "UNMATCHED" | "IGNORED" }) =>
      api.patch(`/accounting/bank/${id}?branchId=${branchId}`, { status }),
    onSuccess: refresh,
    onError: (e) => toast.error(err(e)),
  });
  const autoMatch = useMutation({
    mutationFn: () => api.post<{ matched: number }>(`/accounting/bank/auto-match?branchId=${branchId}`),
    onSuccess: (r) => {
      refresh();
      toast.success(`${r.matched} new match(es)`);
    },
  });
  const match = useMutation({
    mutationFn: ({ id, expenseId }: { id: string; expenseId: string }) =>
      api.post(`/accounting/bank/${id}/match?branchId=${branchId}`, { expenseId }),
    onSuccess: () => {
      setPicking(null);
      refresh();
    },
    onError: (e) => toast.error(err(e)),
  });
  const candidates = useQuery({
    queryKey: ["acct", "bank-cand", picking],
    queryFn: () => api.get<Candidate[]>(`/accounting/bank/${picking}/candidates?branchId=${branchId}`),
    enabled: !!picking && !!branchId,
  });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_500_000) return toast.error("Statement is too large (max 1.5 MB)");
    importCsv.mutate(await f.text());
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="bank-csv" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button onClick={() => fileRef.current?.click()} disabled={importCsv.isPending}>
          <Upload className="mr-2 h-4 w-4" /> Import bank statement (CSV)
        </Button>
        <Button variant="outline" onClick={() => autoMatch.mutate()} disabled={autoMatch.isPending}>Auto-match</Button>
        <p className="text-xs text-muted-foreground">
          Needs date, description and amount (or debit/credit) columns. Money-out lines match expenses with the same amount within 5 days.
        </p>
      </Card>

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Matched", data.summary.matched],
            ["Unmatched", data.summary.unmatched],
            ["Money in", formatCurrency(data.summary.moneyIn)],
            ["Money out", formatCurrency(Math.abs(data.summary.moneyOut))],
          ].map(([l, v]) => (
            <Card key={String(l)} className="p-3">
              <p className="text-xs text-muted-foreground">{l}</p>
              <p className="text-lg font-semibold tabular-nums">{v}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-x-auto p-4">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : data && data.transactions.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr key={t.id} className="border-t border-border align-top">
                  <td className="py-1.5 whitespace-nowrap">{t.postedOn.slice(0, 10)}</td>
                  <td>
                    {t.description}
                    {t.expense && <span className="block text-xs text-muted-foreground">↳ {t.expense.category}{t.expense.note ? ` · ${t.expense.note}` : ""}</span>}
                  </td>
                  <td className={cn("text-right tabular-nums", t.amount < 0 ? "text-foreground" : "text-emerald-600")}>{formatCurrency(t.amount)}</td>
                  <td>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", t.status === "MATCHED" ? "bg-emerald-500/15 text-emerald-600" : t.status === "IGNORED" ? "bg-secondary text-muted-foreground" : "bg-amber-500/15 text-amber-600")}>
                      {t.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="space-x-3 text-right text-xs">
                    {t.status === "UNMATCHED" && t.amount < 0 && (
                      <button type="button" className="text-primary hover:underline" onClick={() => setPicking(picking === t.id ? null : t.id)}>Match</button>
                    )}
                    {t.status === "UNMATCHED" && (
                      <button type="button" className="text-muted-foreground hover:underline" onClick={() => setStatus.mutate({ id: t.id, status: "IGNORED" })}>Ignore</button>
                    )}
                    {t.status !== "UNMATCHED" && (
                      <button type="button" className="text-muted-foreground hover:underline" onClick={() => setStatus.mutate({ id: t.id, status: "UNMATCHED" })}>Undo</button>
                    )}
                    {picking === t.id && (
                      <div className="mt-2 flex flex-col gap-1 rounded-lg border border-border bg-card p-2 text-left">
                        {candidates.isLoading && <span className="text-muted-foreground">Looking…</span>}
                        {candidates.data?.length === 0 && <span className="text-muted-foreground">No unmatched expenses nearby</span>}
                        {candidates.data?.map((c) => (
                          <button key={c.id} type="button" className="rounded px-2 py-1 text-left hover:bg-secondary" onClick={() => match.mutate({ id: t.id, expenseId: c.id })}>
                            {c.spentOn.slice(0, 10)} · {c.category} · {formatCurrency(Number(c.amount))}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No bank lines yet. Import a statement CSV to start reconciling.</p>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------- Balance sheet ----------------------------- */

interface BalanceSheet {
  asOf: string;
  assets: { label: string; amount: number }[];
  liabilities: { label: string; amount: number }[];
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  note: string;
}

function Line({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between py-1.5 text-sm", strong && "border-t border-border font-semibold")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{formatCurrency(amount)}</span>
    </div>
  );
}

export function BalanceSheetTab({ branchId }: { branchId: string | null }) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const { data, isLoading } = useQuery({
    queryKey: ["acct", "balance", branchId, asOf],
    queryFn: () => api.get<BalanceSheet>(`/accounting/balance-sheet?branchId=${branchId}&asOf=${asOf}`),
    enabled: !!branchId,
  });
  return (
    <div className="flex flex-col gap-4">
      <Input type="date" className="w-44" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="Balance sheet as of" />
      {isLoading || !data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-2 font-medium">Assets</h3>
            {data.assets.map((a) => <Line key={a.label} {...a} />)}
            <Line label="Total assets" amount={data.totalAssets} strong />
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 font-medium">Liabilities &amp; equity</h3>
            {data.liabilities.map((a) => <Line key={a.label} {...a} />)}
            <Line label="Total liabilities" amount={data.totalLiabilities} strong />
            <Line label="Owner's equity" amount={data.equity} strong />
          </Card>
          <p className="text-xs text-muted-foreground md:col-span-2">{data.note}</p>
        </div>
      )}
    </div>
  );
}
