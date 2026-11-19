"use client";

import { Clock, Trash2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ScanOrderInput } from "@/components/orders/scan-order-input";
import { DeleteOrdersDialog } from "@/components/orders/delete-orders-dialog";
import { ChannelBadge, TypeBadge } from "@/components/orders/channel-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { useBranch } from "@/hooks/use-branch";
import {
  useManagedOrders,
  useReleaseOrder,
  type ManagedOrder,
  type OrderChannel,
  type OrderTab,
} from "@/hooks/use-orders";
import { formatCurrency } from "@/lib/format";
import { openEntity } from "@/lib/entity-events";
import { cn } from "@/lib/utils";

const TABS: { key: OrderTab; label: string }[] = [
  { key: "pending", label: "New (to accept)" },
  { key: "active", label: "In progress" },
  { key: "history", label: "History" },
];

// One chip = one filter. Online/Offline filter by channel, the rest by how
// the order is fulfilled.
const FILTERS: { key: string; label: string; channel?: OrderChannel; type?: string }[] = [
  { key: "all", label: "All" },
  { key: "online", label: "Online", channel: "ONLINE" },
  { key: "offline", label: "Offline", channel: "STAFF" },
  { key: "takeaway", label: "Takeaway", type: "TAKEAWAY" },
  { key: "delivery", label: "Delivery", type: "DELIVERY" },
  { key: "dinein", label: "Dine-in", type: "DINE_IN" },
];

const chip = (on: boolean) =>
  cn(
    "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
    on
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-muted-foreground hover:bg-secondary",
  );

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function OrdersView() {
  const { branchId } = useBranch();
  // Deep links from the dashboard (?tab=history&filter=online) pick the
  // starting view; after that the chips and tabs drive it as before.
  const params = useSearchParams();
  const [tab, setTab] = useState<OrderTab>(() => {
    const t = params.get("tab");
    return TABS.some((x) => x.key === t) ? (t as OrderTab) : "pending";
  });
  const [filterKey, setFilterKey] = useState(() => {
    const f = params.get("filter");
    return FILTERS.some((x) => x.key === f) ? (f as string) : "all";
  });
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const { data: orders, isLoading } = useManagedOrders(branchId, tab, filter.channel, filter.type);
  const { data: pendingOrders } = useManagedOrders(branchId, "pending");
  const pendingCount = pendingOrders?.length ?? 0;

  // Admin-only multi-select delete of finished transactions (History tab).
  const { data: me } = useCurrentUser();
  const canDelete =
    hasPermission(me?.user, "orders.delete") &&
    ["OWNER", "ADMINISTRATOR"].includes(me?.user.roleName ?? "");
  const selectable = canDelete && tab === "history";
  const finished = (orders ?? []).filter((o) => o.status === "PAID" || o.status === "CANCELLED");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const visibleSelected = finished.filter((o) => selected.has(o.id)).map((o) => o.id);
  const allSelected = finished.length > 0 && visibleSelected.length === finished.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(finished.map((o) => o.id)));

  return (
    <div className="flex flex-col gap-5">
      {/* Header + Search bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Orders</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Live orders, kitchen progress, and full transaction history
          </p>
        </div>
        <div className="w-full sm:w-80 md:w-96">
          <ScanOrderInput branchId={branchId} />
        </div>
      </div>

      {/* Tabs & Filters bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-3">
        {/* Apple Segmented Control for main tabs */}
        <div role="tablist" aria-label="Order stages" className="inline-flex h-9.5 items-center rounded-xl bg-secondary/70 p-1 border border-border/50">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setTab(t.key);
                  setSelected(new Set());
                }}
                className={cn(
                  "relative flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95",
                  active
                    ? "bg-card text-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t.label}</span>
                {t.key === "pending" && pendingCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white shadow-xs">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {FILTERS.map((f) => {
            const active = filterKey === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilterKey(f.key)}
                className={cn(
                  "shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-95",
                  active
                    ? "bg-primary text-white font-semibold shadow-xs"
                    : "border border-border/60 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {selectable && finished.length > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all transactions" />
          Select all {finished.length}
        </label>
      )}

      <Card className="flex flex-col divide-y divide-border/60 overflow-hidden border border-border/80 bg-card shadow-xs">
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-18 rounded-xl" />
            ))}
          </div>
        ) : orders && orders.length > 0 ? (
          orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              selectable={selectable && (o.status === "PAID" || o.status === "CANCELLED")}
              selected={selected.has(o.id)}
              onToggle={() => toggle(o.id)}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/70 text-muted-foreground">
              <Clock className="h-6 w-6 opacity-40" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {tab === "pending" ? "No new orders waiting" : "No orders found"}
            </p>
            <p className="text-xs text-muted-foreground max-w-sm">
              {tab === "pending"
                ? "New online & QR orders will appear here automatically with real-time sound alerts."
                : "Try selecting a different filter category or stage above."}
            </p>
          </div>
        )}
      </Card>

      {/* Floating bar: transform/opacity only, instant under reduced motion */}
      <div
        aria-hidden={visibleSelected.length === 0}
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          visibleSelected.length > 0 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-[0_12px_32px_rgba(23,21,34,0.14)]",
            visibleSelected.length > 0 && "pointer-events-auto",
          )}
        >
          <span className="text-sm font-medium tabular-nums text-foreground" aria-live="polite">
            {visibleSelected.length} selected
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tabIndex={visibleSelected.length > 0 ? 0 : -1}
            onClick={() => setSelected(new Set())}
          >
            <X className="h-4 w-4" aria-hidden /> Clear
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            tabIndex={visibleSelected.length > 0 ? 0 : -1}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete
          </Button>
        </div>
      </div>

      <DeleteOrdersDialog
        branchId={branchId}
        orderIds={visibleSelected}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onDeleted={() => setSelected(new Set())}
      />
    </div>
  );
}

function OrderRow({
  order,
  selectable,
  selected,
  onToggle,
}: {
  order: ManagedOrder;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = order.guestName ?? order.customer?.name ?? "Walk-in guest";
  const summary = order.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(", ");
  const rejected = order.acceptance === "REJECTED";
  const { branchId } = useBranch();
  const release = useReleaseOrder(branchId);
  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-lg transition-colors duration-150 motion-reduce:transition-none",
        selected && "bg-primary/5",
      )}
    >
      {selectable && (
        <div className="flex h-full items-center py-4 pl-4">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={`Select transaction #${order.orderNumber}`}
          />
        </div>
      )}
    <button
      type="button"
      onClick={() => openEntity("Order", order.id)}
      className="flex flex-1 items-start justify-between gap-3 p-3.5 sm:px-5 sm:py-4 text-left transition hover:bg-secondary/40 active:bg-secondary/60"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="font-mono text-xs sm:text-sm font-bold tracking-tight text-foreground">
            #{order.orderNumber}
          </span>
          <span className="text-xs sm:text-sm font-semibold text-foreground truncate max-w-[140px] sm:max-w-xs">
            {name}
          </span>
          <ChannelBadge channel={order.channel} />
          <TypeBadge type={order.type} />
          {order.acceptance === "PENDING" && (
            <Badge className="font-semibold bg-primary text-white text-[11px]">Needs action</Badge>
          )}
          {order.status === "OPEN" && order.payIntent === "CASH" && (
            <Badge variant="outline" className="border-warning/60 bg-warning/10 text-[11px] font-semibold text-warning">Cash due</Badge>
          )}
          {order.status === "OPEN" && order.heldForPayment && (
            <>
              <Badge variant="outline" className="border-warning/60 bg-warning/10 text-[11px] font-semibold text-warning">Awaiting payment</Badge>
              <Button size="xs" variant="outline" className="h-6 text-[10px] font-medium" disabled={release.isPending} onClick={(e) => { e.stopPropagation(); release.mutate(order.id); }}>Send to kitchen</Button>
            </>
          )}
          {rejected && <Badge variant="secondary" className="font-medium text-[11px] text-destructive bg-destructive/10">Rejected</Badge>}
          {!rejected && order.status === "CANCELLED" && (
            <Badge variant="secondary" className="font-medium text-[11px]">Cancelled</Badge>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed sm:line-clamp-1">
          {summary}
        </p>
        {order.type === "DELIVERY" && order.deliveryAddress && (
          <p className="truncate text-[11px] text-muted-foreground font-medium">
            📍 {order.deliveryAddress}
            {order.deliveryLat != null ? " · location pinned" : ""}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pl-2">
        <span className="text-sm sm:text-base font-bold tabular-nums text-foreground tracking-tight">
          {formatCurrency(order.totalAmount)}
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Clock className="h-3 w-3" /> {timeAgo(order.createdAt)}
        </span>
      </div>
    </button>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <OrdersView />
    </Suspense>
  );
}
