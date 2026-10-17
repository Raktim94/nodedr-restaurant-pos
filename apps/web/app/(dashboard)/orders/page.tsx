"use client";

import { Clock, Trash2, X } from "lucide-react";
import { useState } from "react";
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

export default function OrdersPage() {
  const { branchId } = useBranch();
  const [tab, setTab] = useState<OrderTab>("pending");
  const [filterKey, setFilterKey] = useState("all");
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
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Accept new online orders and manage everything in progress
        </p>
      </div>

      <ScanOrderInput branchId={branchId} />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => {
              setTab(t.key);
              setSelected(new Set());
            }} className={chip(tab === t.key)}>
            {t.label}
            {t.key === "pending" && pendingCount > 0 && (
              <span className="ml-2 rounded-full bg-destructive px-1.5 text-xs text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterKey(f.key)}
            className={cn(chip(filterKey === f.key), "py-1 text-xs")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {selectable && finished.length > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all transactions" />
          Select all {finished.length}
        </label>
      )}

      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
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
          <div className="flex flex-col items-center gap-1 py-16 text-center">
            <p className="text-sm font-medium text-foreground">
              {tab === "pending" ? "No orders waiting for you" : "No orders here"}
            </p>
            <p className="text-sm text-muted-foreground">
              New online orders appear here with a sound alert.
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
      className="flex flex-1 items-start justify-between gap-4 rounded-lg px-4 py-3 text-left transition hover:bg-secondary/50"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">#{order.orderNumber}</span>
          <span className="text-sm text-foreground">{name}</span>
          <ChannelBadge channel={order.channel} />
          <TypeBadge type={order.type} />
          {order.acceptance === "PENDING" && (
            <Badge className="font-normal">Needs action</Badge>
          )}
          {rejected && <Badge variant="secondary" className="font-normal">Rejected</Badge>}
          {!rejected && order.status === "CANCELLED" && (
            <Badge variant="secondary" className="font-normal">Cancelled</Badge>
          )}
        </div>
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatCurrency(order.totalAmount)}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> {timeAgo(order.createdAt)}
        </span>
      </div>
    </button>
    </div>
  );
}
