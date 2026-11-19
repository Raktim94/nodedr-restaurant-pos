"use client";

import { useQuery } from "@tanstack/react-query";
import { 
  BarChart3, 
  Calendar, 
  ChevronDown, 
  Download, 
  FileSpreadsheet, 
  FileText, 
  Filter, 
  Printer, 
  Receipt, 
  Search, 
  SlidersHorizontal, 
  TrendingUp, 
  Users, 
  UtensilsCrossed, 
  Wallet,
  Clock
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SchedulesPanel } from "@/components/reports/schedules-panel";

interface CatalogEntry {
  key: string;
  title: string;
  group: string;
}

interface ReportResult {
  key: string;
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const GROUP_ICONS: Record<string, React.ElementType> = {
  Sales: TrendingUp,
  Tax: Receipt,
  Analytics: BarChart3,
  Customers: Users,
  Staff: Users,
  Operations: UtensilsCrossed,
  Inventory: FileSpreadsheet,
};

export default function ReportsPage() {
  const { branchId } = useBranch();
  const { data: me } = useCurrentUser();
  const canExport = hasPermission(me?.user, "data.export");
  const [key, setKey] = useState("sales-daily");
  const [range, setRange] = useState(() => ({
    from: iso(new Date(Date.now() - 29 * 86_400_000)),
    to: iso(new Date()),
  }));
  const [activeGroup, setActiveGroup] = useState<string>("Sales");

  const { data: catalog } = useQuery({
    queryKey: ["reports", "catalog"],
    queryFn: () => api.get<CatalogEntry[]>("/reports"),
  });

  const qs = `branchId=${branchId}&from=${range.from}&to=${range.to}`;
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", key, branchId, range.from, range.to],
    queryFn: () => api.get<ReportResult>(`/reports/${key}?${qs}`),
    enabled: !!branchId && range.from <= range.to,
    retry: false,
  });

  const groups = useMemo(() => {
    return [...new Set(catalog?.map((c) => c.group) ?? [])];
  }, [catalog]);

  const currentEntry = catalog?.find((c) => c.key === key);

  // Quick Date Range Presets (Apple HIG familiar shortcuts)
  const setPresetRange = (days: number) => {
    setRange({
      from: iso(new Date(Date.now() - (days - 1) * 86_400_000)),
      to: iso(new Date()),
    });
  };

  const isToday = range.from === iso(new Date()) && range.to === iso(new Date());
  const is7d = range.from === iso(new Date(Date.now() - 6 * 86_400_000)) && range.to === iso(new Date());
  const is30d = range.from === iso(new Date(Date.now() - 29 * 86_400_000)) && range.to === iso(new Date());

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Top Sticky Header Section: Title & Date Range / Export Toolbar */}
      <div className="flex flex-col gap-3 shrink-0 print:hidden">
        {/* Page Title */}
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Analytics & Reports
          </h1>
          <p className="text-xs text-muted-foreground">
            Real-time metrics, historical revenue statements, customer behavior, and scheduled audits
          </p>
        </div>

        {/* Date Filter & Export Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 sm:p-3.5 rounded-2xl border border-border/80 bg-card shadow-2xs">
          {/* Preset Range Selector & Date Inputs */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            {/* Quick Segmented Control for ranges */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl w-fit border border-border/40">
              <button
                type="button"
                onClick={() => setPresetRange(1)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all active:scale-97",
                  isToday ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setPresetRange(7)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all active:scale-97",
                  is7d ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => setPresetRange(30)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all active:scale-97",
                  is30d ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                30 Days
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="Start date"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl w-full sm:w-36 font-medium tabular-nums"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
              <span className="text-xs text-muted-foreground font-medium">to</span>
              <Input
                type="date"
                aria-label="End date"
                className="h-11 sm:h-9 text-xs sm:text-sm rounded-xl w-full sm:w-36 font-medium tabular-nums"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </div>
          </div>

          {/* Actions / Export Bar */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pt-1 md:pt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="h-11 sm:h-9 rounded-xl text-xs font-medium gap-1.5 active:scale-98 shrink-0"
            >
              <Printer className="h-4 w-4 text-muted-foreground" />
              <span>Print</span>
            </Button>

            {canExport && (
              <div className="flex items-center gap-1.5">
                <a
                  href={`/api/v1/reports/${key}/export?${qs}&format=xlsx`}
                  className="inline-flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-muted active:scale-98 transition-all shrink-0"
                  download
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Excel</span>
                </a>
                <a
                  href={`/api/v1/reports/${key}/export?${qs}&format=pdf`}
                  className="inline-flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-muted active:scale-98 transition-all shrink-0"
                  download
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>PDF</span>
                </a>
                <a
                  href={`/api/v1/reports/${key}/export?${qs}&format=csv`}
                  className="inline-flex h-11 sm:h-9 items-center justify-center gap-1.5 rounded-xl border border-border/80 bg-background px-3 text-xs font-medium text-foreground hover:bg-muted active:scale-98 transition-all shrink-0"
                  download
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>CSV</span>
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Layout: Two-pane Split View with Fixed Sidebar & Dedicated Scrollable Content */}
      <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr] gap-5 flex-1 min-h-0 items-stretch">
        {/* Mobile Report Category Picker: iOS Native Select */}
        <div className="w-full lg:hidden flex flex-col gap-2.5 print:hidden shrink-0">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Report</span>
            <span className="text-xs font-semibold text-primary">{currentEntry?.title}</span>
          </div>

          <div className="relative">
            <select
              aria-label="Select report type"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                const found = catalog?.find((c) => c.key === e.target.value);
                if (found) setActiveGroup(found.group);
              }}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-xs font-bold text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 shadow-2xs"
            >
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {catalog
                    ?.filter((c) => c.group === g)
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.title}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {/* Desktop Fixed Sidebar Navigation (Scrolls internally if viewport is small) */}
        <nav
          className="hidden lg:flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-3 shadow-2xs h-full overflow-y-auto scrollbar-none print:hidden shrink-0"
          aria-label="Reports Catalog"
        >
          {groups.map((g) => {
            const Icon = GROUP_ICONS[g] ?? BarChart3;
            const items = catalog?.filter((c) => c.group === g) ?? [];

            return (
              <div key={g} className="flex flex-col gap-1 shrink-0">
                <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{g}</span>
                </div>

                <div className="flex flex-col gap-0.5">
                  {items.map((c) => {
                    const isSelected = key === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => {
                          setKey(c.key);
                          setActiveGroup(g);
                        }}
                        className={cn(
                          "flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium text-left transition-all active:scale-98 select-none",
                          isSelected
                            ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                            : "text-foreground hover:bg-muted/70"
                        )}
                      >
                        <span>{c.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Right Pane: Report Detail & Table Output (Independently Scrollable on Desktop) */}
        <div className="flex min-w-0 w-full flex-col gap-5 lg:overflow-y-auto lg:pr-1 pb-16 lg:pb-6">
          {/* Active Report Header Card */}
          <Card className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/60">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-foreground">
                    {data?.title ?? currentEntry?.title ?? "Report"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Range: <strong className="font-semibold text-foreground">{range.from}</strong> to <strong className="font-semibold text-foreground">{range.to}</strong>
                  </p>
                </div>
              </div>

              {data && (
                <div className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-secondary text-muted-foreground w-fit">
                  {data.rows.length} record(s)
                </div>
              )}
            </div>

            {/* Table or Loading State */}
            <div className="pt-4 overflow-x-auto scrollbar-none">
              {isLoading ? (
                <div className="flex flex-col gap-2.5 py-4">
                  <Skeleton className="h-8 w-full rounded-xl" />
                  <Skeleton className="h-8 w-full rounded-xl" />
                  <Skeleton className="h-8 w-full rounded-xl" />
                  <Skeleton className="h-8 w-full rounded-xl" />
                </div>
              ) : error ? (
                <div className="p-8 text-center text-xs sm:text-sm text-destructive rounded-xl border border-dashed border-destructive/30 bg-destructive/5">
                  {error instanceof ApiError ? error.message : "Could not load report"}
                </div>
              ) : data && data.rows.length > 0 ? (
                <table className="w-full text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border/80 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {data.columns.map((c, colIdx) => (
                        <th key={c} className={cn("py-2.5 px-3 whitespace-nowrap", colIdx > 0 && "text-right")}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors">
                        {r.map((cell, j) => (
                          <td
                            key={j}
                            className={cn(
                              "py-3 px-3 tabular-nums font-medium text-foreground whitespace-nowrap",
                              j === 0 ? "font-semibold" : "text-right text-muted-foreground"
                            )}
                          >
                            {cell ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-12 text-center flex flex-col items-center justify-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    <FileText className="h-5 w-5" />
                  </div>
                  <span className="text-xs sm:text-sm font-semibold text-foreground">No records found</span>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    No transactions or movements matched the selected date period. Try selecting a broader range above.
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Schedules Panel */}
          {canExport && (
            <SchedulesPanel
              branchId={branchId}
              reportKey={key}
              titles={Object.fromEntries((catalog ?? []).map((c) => [c.key, c.title]))}
            />
          )}
        </div>
      </div>
    </div>
  );
}
