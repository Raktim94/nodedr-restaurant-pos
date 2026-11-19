"use client";

import { BranchNotice } from "@/components/layout/branch-notice";
import { AlertTriangle, ChefHat, SlidersHorizontal, ClipboardList, Flame, Globe, HandCoins, ReceiptText, Store, Timer, TrendingUp, Trash2, UserRound, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { OrderDetailDialog } from "@/components/orders/order-detail-dialog";
import { RefundDialog } from "@/components/orders/refund-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import { useManagedOrders } from "@/hooks/use-orders";
import { openEntity } from "@/lib/entity-events";
import { CustomizePanel } from "@/components/dashboard/customize-panel";
import {
  DEFAULT_DASHBOARD_PREFS,
  useDashboardPrefs,
  useDashboardSummary,
  useDashboardTrends,
  useSaveDashboardPrefs,
} from "@/hooks/use-dashboard";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const ONLINE_ORDER_TYPES = new Set(["QR_ORDER", "KIOSK"]);

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  href,
  size = "default",
  className,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  accent?: "success" | "warning";
  /** Where the full records behind this number live. */
  href: string;
  /** hero = the one number to look at first; compact = supporting figures. */
  size?: "hero" | "default" | "compact";
  className?: string;
}) {
  const hero = size === "hero";
  const compact = size === "compact";
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}. Open details`}
      className={cn(
        "group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-98 transition-transform",
        className,
      )}
    >
      <Card
        className={cn(
          "relative flex h-full flex-col justify-between overflow-hidden border border-border/80 bg-card transition-all duration-150 hover:border-primary/50 hover:shadow-xs shadow-2xs rounded-2xl",
          hero
            ? "gap-4 p-5 sm:p-6"
            : compact
              ? "gap-2 p-3.5 sm:p-4"
              : "gap-3 p-4 sm:p-5",
          accent === "warning" && !hero && "border-warning/30",
        )}
      >
        {hero && (
          <div className="absolute top-0 left-0 h-1 w-full bg-primary" />
        )}
        <div className="flex items-center justify-between">
          <span className={cn("font-medium text-muted-foreground", compact ? "text-xs" : "text-xs sm:text-[13px]")}>
            {label}
          </span>
          <div
            className={cn(
              "flex items-center justify-center rounded-xl",
              compact ? "h-7 w-7" : "h-9 w-9",
              accent === "success" && "bg-success/15 text-success",
              accent === "warning" && "bg-warning/15 text-warning",
              !accent && (hero ? "bg-primary/15 text-primary" : "bg-secondary text-foreground"),
            )}
          >
            <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4 sm:h-[18px] sm:w-[18px]"} />
          </div>
        </div>
        <div className="flex flex-col">
          <span
            className={cn(
              "font-bold tabular-nums tracking-tight text-foreground",
              hero ? "text-2xl sm:text-3xl lg:text-4xl" : compact ? "text-base sm:text-lg" : "text-xl sm:text-2xl",
            )}
          >
            {value}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function TableStatusRow({
  label,
  count,
  dotClass,
  href,
}: {
  label: string;
  count: number;
  dotClass: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${count}. Open`}
      className="-mx-2 flex items-center justify-between rounded-xl px-2.5 py-2 text-xs sm:text-sm outline-none transition hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-primary active:scale-98"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        <span className="text-muted-foreground font-medium">{label}</span>
      </div>
      <span className="font-bold tabular-nums text-foreground">{count}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const { branchId } = useBranch();
  const { data, isLoading } = useDashboardSummary(branchId);
  const { data: prefsData } = useDashboardPrefs();
  const prefs = prefsData ?? DEFAULT_DASHBOARD_PREFS;
  const savePrefs = useSaveDashboardPrefs();
  const { data: trends, isLoading: trendsLoading } = useDashboardTrends(branchId, prefs.trendDays);
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const { data: me } = useCurrentUser();
  const [now] = useState(() => new Date());
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (me?.user?.name ?? "").trim().split(/\s+/)[0];
  const today = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  // Layout only: where a widget sits and whether it shows. CSS `order` keeps
  // the existing markup in place, and a hidden widget is simply not displayed.
  const slot = (group: "top" | "card", id: string, className = "") => {
    const list = group === "top" ? prefs.topOrder : prefs.cardOrder;
    const index = Math.max(list.indexOf(id), 0);
    // Inline display:none always beats a utility class like `flex` or `grid`.
    return {
      className,
      style: {
        order: (group === "top" ? 10 : 100) + index,
        ...(prefs.hidden.includes(id) ? { display: "none" } : {}),
      },
    };
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Live Service Active
            </span>
            <span className="text-xs text-muted-foreground hidden sm:inline">· {today}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-xs text-muted-foreground sm:hidden mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={customizing}
            onClick={() => setCustomizing((v) => !v)}
            className="h-9 rounded-xl border-border bg-card text-xs font-medium"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Customize
          </Button>
        </div>
      </div>

      {customizing && (
        <CustomizePanel
          prefs={prefs}
          saving={savePrefs.isPending}
          onChange={(next) => savePrefs.mutate(next)}
          onClose={() => setCustomizing(false)}
        />
      )}

      <OrderDetailDialog
        branchId={branchId}
        orderId={viewingOrderId}
        open={!!viewingOrderId}
        onOpenChange={(open) => !open && setViewingOrderId(null)}
      />

      <BranchNotice />

      <PendingOrdersBanner branchId={branchId} />

      <QuickActions />

      <div {...slot("top", "kpis")}>
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[110px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(data.todayRevenue)}
            icon={Wallet}
            accent="success"
            href="/reports"
            size="hero"
            className="sm:col-span-2 lg:col-span-1"
          />
          <StatCard
            label="Today's Orders"
            value={String(data.todayOrders)}
            icon={ReceiptText}
            href="/orders?tab=history"
          />
          <StatCard
            label="Occupied Tables"
            value={`${data.tables.occupied} / ${data.tables.available + data.tables.occupied + data.tables.reserved + data.tables.cleaning}`}
            icon={ClipboardList}
            href="/tables"
          />
          <StatCard
            label="Kitchen Queue"
            value={String(
              data.kitchenQueue.new + data.kitchenQueue.accepted + data.kitchenQueue.preparing,
            )}
            icon={Flame}
            accent="warning"
            href="/kds"
          />
        </div>
      )}
      </div>

      {data && (
        <div {...slot("top", "attention", "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5")}>
          <StatCard
            size="compact"
            label="Pending payments"
            value={
              data.pendingPayments.count === 0
                ? "0"
                : `${data.pendingPayments.count} (${formatCurrency(data.pendingPayments.balance)})`
            }
            icon={HandCoins}
            accent={data.pendingPayments.count > 0 ? "warning" : undefined}
            href="/orders?tab=active"
          />
          {data.lowStock !== null && (
            <StatCard
              size="compact"
              label="Low stock items"
              value={String(data.lowStock)}
              icon={AlertTriangle}
              accent={data.lowStock > 0 ? "warning" : undefined}
              href="/inventory?filter=low"
            />
          )}
          {data.customers !== null && (
            <StatCard size="compact" label="Active customers" value={String(data.customers)} icon={Users} href="/customers" />
          )}
          {data.employees !== null && (
            <StatCard size="compact" label="Active team" value={String(data.employees)} icon={UserRound} href="/team" />
          )}
          {data.unpaidPayrollRuns !== null && (
            <StatCard
              size="compact"
              label="Payroll pending"
              value={String(data.unpaidPayrollRuns)}
              icon={Wallet}
              accent={data.unpaidPayrollRuns > 0 ? "warning" : undefined}
              href="/team?tab=payroll"
            />
          )}
        </div>
      )}

      <div {...slot("top", "charts", "grid grid-cols-1 items-start gap-4 lg:grid-cols-2")}>
        <TrendChart
          title={`Revenue — last ${prefs.trendDays} days`}
          icon={TrendingUp}
          data={trends?.revenue ?? []}
          valueKey="amount"
          color="var(--success)"
          valueFormatter={(v) => formatCurrency(v)}
          isLoading={trendsLoading}
          emptyMessage={`No paid orders in the last ${prefs.trendDays} days yet.`}
        />
        <TrendChart
          title={`Food waste cost — last ${prefs.trendDays} days`}
          icon={Trash2}
          data={trends?.waste ?? []}
          valueKey="cost"
          color="var(--warning)"
          valueFormatter={(v) => formatCurrency(v)}
          isLoading={trendsLoading}
          emptyMessage={`No waste logged in the last ${prefs.trendDays} days — nice.`}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ order: 100 }}>
        <Card {...slot("card", "tables", "flex flex-col gap-1.5 p-5 sm:p-6")}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Tables & Floor</h2>
            <Link href="/tables" className="text-xs font-semibold text-primary hover:underline">
              View floor
            </Link>
          </div>
          {data && (
            <div className="flex flex-col divide-y divide-border/60">
              <TableStatusRow label="Available" count={data.tables.available} dotClass="bg-success" href="/tables" />
              <TableStatusRow label="Occupied" count={data.tables.occupied} dotClass="bg-primary" href="/tables" />
              <TableStatusRow label="Reserved" count={data.tables.reserved} dotClass="bg-warning" href="/tables" />
              <TableStatusRow label="Cleaning" count={data.tables.cleaning} dotClass="bg-muted-foreground" href="/tables" />
            </div>
          )}
        </Card>

        <Card {...slot("card", "kitchen", "flex flex-col gap-1.5 p-5 sm:p-6")}>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <ChefHat className="h-[18px] w-[18px] text-primary" />
              Kitchen queue
            </h2>
            <Link href="/kds" className="text-xs font-semibold text-primary hover:underline">
              Open KDS
            </Link>
          </div>
          {data && (
            <div className="flex flex-col divide-y divide-border/60">
              <TableStatusRow label="New incoming" count={data.kitchenQueue.new} dotClass="bg-primary" href="/kds" />
              <TableStatusRow label="Accepted" count={data.kitchenQueue.accepted} dotClass="bg-warning" href="/kds" />
              <TableStatusRow label="Preparing" count={data.kitchenQueue.preparing} dotClass="bg-warning" href="/kds" />
              <TableStatusRow label="Ready for pickup" count={data.kitchenQueue.ready} dotClass="bg-success" href="/kds" />
            </div>
          )}
        </Card>

        <Card {...slot("card", "recent", "flex flex-col gap-3 p-5 sm:p-6")}>
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Timer className="h-[18px] w-[18px] text-primary" />
              Recent sales
            </h2>
            <Link href="/orders?tab=history" className="text-xs font-semibold text-primary hover:underline">
              All history
            </Link>
          </div>
          <div className="flex flex-col divide-y divide-border/60">
            {data?.recentOrders.length === 0 && (
              <p className="py-4 text-xs text-muted-foreground">No orders recorded yet today.</p>
            )}
            {data?.recentOrders.map((order) => {
              const isOnline = ONLINE_ORDER_TYPES.has(order.type);
              return (
                <div key={order.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setViewingOrderId(order.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg text-left outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
                    title="View order details"
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">#{order.orderNumber}</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "mt-0.5 w-fit text-[10px] font-semibold tracking-wide",
                          isOnline && "border-primary/20 bg-primary/10 text-primary",
                        )}
                      >
                        {order.type.replace("_", " ")}
                      </Badge>
                    </div>
                    <span className="font-bold tabular-nums text-foreground">
                      {formatCurrency(order.totalAmount)}
                    </span>
                  </button>
                  <RefundDialog
                    branchId={branchId}
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    maxAmount={Number(order.totalAmount)}
                  />
                </div>
              );
            })}
          </div>
        </Card>

        <Card {...slot("card", "channels", "flex flex-col gap-3 p-5 sm:p-6")}>
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <ReceiptText className="h-[18px] w-[18px] text-primary" />
              Order channels
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Today's breakdown by channel</p>
          </div>
          {data && (
            <>
              <div className="flex flex-col gap-1.5 pt-1">
                <Link
                  href="/orders?tab=history&filter=online"
                  aria-label={`Online orders today: ${data.channels.online}. Open`}
                  className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-xs outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="h-3.5 w-3.5 text-info" />
                    Online (QR / Kiosk)
                  </div>
                  <span className="font-bold tabular-nums text-foreground">
                    {data.channels.online}
                  </span>
                </Link>
                <Link
                  href="/orders?tab=history&filter=offline"
                  aria-label={`Offline orders today: ${data.channels.offline}. Open`}
                  className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Store className="h-3.5 w-3.5 text-primary" />
                    Offline (Dine-in / Takeaway)
                  </div>
                  <span className="font-bold tabular-nums text-foreground">
                    {data.channels.offline}
                  </span>
                </Link>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${
                      data.channels.online + data.channels.offline === 0
                        ? 0
                        : (data.channels.online / (data.channels.online + data.channels.offline)) * 100
                    }%`,
                  }}
                />
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// Online orders waiting for a decision — shown on top so they can't be missed.
function PendingOrdersBanner({ branchId }: { branchId: string | null }) {
  const { data } = useManagedOrders(branchId, "pending");
  if (!data || data.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3.5 border-primary/40 bg-primary/5 p-4 sm:p-5 sm:flex-row sm:items-center sm:justify-between rounded-2xl shadow-2xs">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm shrink-0 shadow-xs">
          {data.length}
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">
            {data.length} online order{data.length === 1 ? "" : "s"} waiting for decision
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Accept or reject immediately so the kitchen line can begin prep.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openEntity("Order", data[0].id)}
          className="h-11 sm:h-9 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs active:scale-98 transition-all"
        >
          Review #{data[0].orderNumber}
        </button>
        <Link 
          href="/orders" 
          className="inline-flex h-11 sm:h-9 items-center justify-center rounded-xl border border-border/80 bg-background px-4 text-xs font-semibold text-foreground hover:bg-muted active:scale-98 transition-all"
        >
          All Orders
        </Link>
      </div>
    </Card>
  );
}
