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
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  accent?: "success" | "warning";
  /** Where the full records behind this number live. */
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}. Open details`}
      className="group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
    <Card className="flex h-full flex-col gap-3 p-6 transition group-hover:border-primary/40 group-hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl",
            accent === "success" && "bg-success/10 text-success",
            accent === "warning" && "bg-warning/10 text-warning",
            !accent && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </span>
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
      className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-sm outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="font-medium tabular-nums text-foreground">{count}</span>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Real-time overview of today&apos;s service</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={customizing}
          onClick={() => setCustomizing((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Customize
        </Button>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(data.todayRevenue)}
            icon={Wallet}
            accent="success"
            href="/reports"
          />
          <StatCard
            label="Today's Orders"
            value={String(data.todayOrders)}
            icon={ReceiptText}
            href="/orders?tab=history"
          />
          <StatCard
            label="Occupied Tables"
            value={String(data.tables.occupied)}
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
        <div {...slot("top", "attention", "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5")}>
          <StatCard
            label="Pending payments"
            value={
              data.pendingPayments.count === 0
                ? "0"
                : `${data.pendingPayments.count} · ${formatCurrency(data.pendingPayments.balance)}`
            }
            icon={HandCoins}
            accent={data.pendingPayments.count > 0 ? "warning" : undefined}
            href="/orders?tab=active"
          />
          {data.lowStock !== null && (
            <StatCard
              label="Low stock"
              value={String(data.lowStock)}
              icon={AlertTriangle}
              accent={data.lowStock > 0 ? "warning" : undefined}
              href="/inventory?filter=low"
            />
          )}
          {data.customers !== null && (
            <StatCard label="Customers" value={String(data.customers)} icon={Users} href="/customers" />
          )}
          {data.employees !== null && (
            <StatCard label="Team members" value={String(data.employees)} icon={UserRound} href="/team" />
          )}
          {data.unpaidPayrollRuns !== null && (
            <StatCard
              label="Payroll to pay"
              value={String(data.unpaidPayrollRuns)}
              icon={Wallet}
              accent={data.unpaidPayrollRuns > 0 ? "warning" : undefined}
              href="/team?tab=payroll"
            />
          )}
        </div>
      )}

      <div {...slot("top", "charts", "grid grid-cols-1 gap-4 lg:grid-cols-2")}>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ order: 100 }}>
        <Card {...slot("card", "tables", "flex flex-col gap-1 p-6 lg:col-span-1")}>
          <h2 className="mb-3 text-[18px] font-medium text-foreground">Tables</h2>
          {data && (
            <>
              <TableStatusRow label="Available" count={data.tables.available} dotClass="bg-success" href="/tables" />
              <TableStatusRow label="Occupied" count={data.tables.occupied} dotClass="bg-primary" href="/tables" />
              <TableStatusRow label="Reserved" count={data.tables.reserved} dotClass="bg-warning" href="/tables" />
              <TableStatusRow label="Cleaning" count={data.tables.cleaning} dotClass="bg-muted-foreground" href="/tables" />
            </>
          )}
        </Card>

        <Card {...slot("card", "kitchen", "flex flex-col gap-1 p-6 lg:col-span-1")}>
          <h2 className="mb-3 flex items-center gap-2 text-[18px] font-medium text-foreground">
            <ChefHat className="h-[18px] w-[18px] text-muted-foreground" />
            Kitchen queue
          </h2>
          {data && (
            <>
              <TableStatusRow label="New" count={data.kitchenQueue.new} dotClass="bg-primary" href="/kds" />
              <TableStatusRow label="Accepted" count={data.kitchenQueue.accepted} dotClass="bg-warning" href="/kds" />
              <TableStatusRow label="Preparing" count={data.kitchenQueue.preparing} dotClass="bg-warning" href="/kds" />
              <TableStatusRow label="Ready" count={data.kitchenQueue.ready} dotClass="bg-success" href="/kds" />
            </>
          )}
        </Card>

        <Card {...slot("card", "recent", "flex flex-col gap-3 p-6 lg:col-span-1")}>
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <Timer className="h-[18px] w-[18px] text-muted-foreground" />
            Recent transactions
          </h2>
          <div className="flex flex-col divide-y divide-border">
            {data?.recentOrders.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">No sales yet today.</p>
            )}
            {data?.recentOrders.map((order) => {
              const isOnline = ONLINE_ORDER_TYPES.has(order.type);
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setViewingOrderId(order.id)}
                  className="flex items-center justify-between py-2.5 text-left text-sm transition hover:opacity-80"
                  title="View order details"
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">#{order.orderNumber}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "mt-0.5 w-fit text-[11px] font-normal",
                        isOnline && "bg-primary/10 text-primary",
                      )}
                    >
                      {order.type.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium tabular-nums text-foreground">
                      {formatCurrency(order.totalAmount)}
                    </span>
                    <RefundDialog
                      branchId={branchId}
                      orderId={order.id}
                      orderNumber={order.orderNumber}
                      maxAmount={Number(order.totalAmount)}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card {...slot("card", "channels", "flex flex-col gap-3 p-6 lg:col-span-1")}>
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <ReceiptText className="h-[18px] w-[18px] text-muted-foreground" />
            Order channels
          </h2>
          <p className="text-xs text-muted-foreground">Today, self-serve vs staff-entered</p>
          {data && (
            <>
              <Link
                href="/orders?tab=history&filter=online"
                aria-label={`Online orders today: ${data.channels.online}. Open`}
                className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-sm outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Globe className="h-3.5 w-3.5" />
                  Online (QR / kiosk)
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {data.channels.online}
                </span>
              </Link>
              <Link
                href="/orders?tab=history&filter=offline"
                aria-label={`Offline orders today: ${data.channels.offline}. Open`}
                className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm outline-none transition hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Store className="h-3.5 w-3.5" />
                  Offline (dine-in / takeaway / phone)
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {data.channels.offline}
                </span>
              </Link>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
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
    <Card className="flex flex-col gap-3 border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">
          {data.length} online order{data.length === 1 ? "" : "s"} waiting for you
        </p>
        <p className="text-xs text-muted-foreground">Accept or reject so the kitchen can start.</p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => openEntity("Order", data[0].id)}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Review #{data[0].orderNumber}
        </button>
        <Link href="/orders" className="rounded-lg border border-border px-3 py-1.5 text-sm">
          All orders
        </Link>
      </div>
    </Card>
  );
}
