"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import {
  useAssignmentHistory,
  useDeliveries,
  useDeliveryActions,
  useDrivers,
  useZoneActions,
  useZones,
  type DeliveryOrder,
  type DeliveryStatus,
} from "@/hooks/use-delivery";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Rider assigned",
  PICKED_UP: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Failed",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

function DeliveryCard({ order, branchId }: { order: DeliveryOrder; branchId: string | null }) {
  const { data: drivers } = useDrivers(branchId);
  const { assign, setStatus } = useDeliveryActions(branchId);
  const status = order.deliveryStatus ?? "UNASSIGNED";
  const [pending, setPending] = useState<string | null>(null); // rider chosen for a reassignment, waiting for a reason
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const { data: history } = useAssignmentHistory(branchId, order.id, showHistory);
  const chosen = drivers?.find((d) => d.id === pending);
  const doAssign = (driverId: string, why?: string) =>
    assign.mutate(
      { orderId: order.id, driverId, reason: why },
      { onSuccess: () => { setPending(null); setReason(""); }, onError: (err) => toast.error(errMsg(err)) },
    );
  const move = (next: DeliveryStatus) =>
    setStatus.mutate({ orderId: order.id, status: next }, { onError: (e) => toast.error(errMsg(e)) });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            #{order.orderNumber} · {order.guestName ?? "Guest"}
          </p>
          <p className="text-xs text-muted-foreground">
            {order.deliveryAddress ?? "Address in notes"}
            {order.deliveryPincode && ` · ${order.deliveryPincode}`}
          </p>
          {order.deliveryPlace && <p className="text-xs text-foreground">Landmark: {order.deliveryPlace}</p>}
          {order.deliveryLat != null && order.deliveryLng != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${order.deliveryLat},${order.deliveryLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-primary underline underline-offset-2"
            >
              Customer shared their location — open map
            </a>
          )}
          {order.deliveryFailedReason && <p className="text-xs text-destructive">Not delivered: {order.deliveryFailedReason}</p>}
          {order.deliveryPhone && (
            <a href={`tel:${order.deliveryPhone}`} className="text-xs text-primary underline underline-offset-2">
              {order.deliveryPhone}
            </a>
          )}
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(order.totalAmount)} + {formatCurrency(order.deliveryFee)} delivery
        {order.deliveryZone && ` · ${order.deliveryZone.name}`}
        {order.deliveryEtaAt && ` · ETA ${time(order.deliveryEtaAt)}`}
        {order.scheduledFor && ` · scheduled ${time(order.scheduledFor)}`}
      </p>
      {order.notes && <p className="text-xs italic text-muted-foreground">{order.notes}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {(status === "UNASSIGNED" || status === "ASSIGNED") && (
          <select
            aria-label="Rider"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id || id === order.driver?.id) return;
              if (order.driver) setPending(id); // moving it to someone else: ask why first
              else doAssign(id);
            }}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">{order.driver ? "Reassign rider…" : "Assign rider…"}</option>
            {drivers?.filter((d) => d.id !== order.driver?.id).map((d) => (
              <option key={d.id} value={d.id}>
                {d.riderOnline ? "● On shift" : "○ Off shift"} · {d.name}
                {d.activeDeliveries > 0 ? ` (${d.activeDeliveries} active)` : " (free)"}
              </option>
            ))}
          </select>
        )}
        {order.driver && status !== "UNASSIGNED" && (
          <span className="text-xs font-medium text-foreground">Rider: {order.driver.name}</span>
        )}
        {status === "UNASSIGNED" && <span className="text-xs font-medium text-muted-foreground">Unassigned</span>}
        {status === "ASSIGNED" && <Button size="sm" onClick={() => move("PICKED_UP")}>Picked up</Button>}
        {status === "PICKED_UP" && <Button size="sm" onClick={() => move("DELIVERED")}>Delivered</Button>}
        {status !== "DELIVERED" && status !== "FAILED" && (
          <Button size="sm" variant="outline" onClick={() => move("FAILED")}>
            Mark failed
          </Button>
        )}
      </div>
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <Input aria-label="Reason for reassigning" className="h-8 min-w-48 flex-1" placeholder={`Why move this to ${chosen?.name ?? "another rider"}? (required)`} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <Button size="sm" disabled={reason.trim().length < 3 || assign.isPending} onClick={() => doAssign(pending, reason)}>Reassign</Button>
          <Button size="sm" variant="outline" onClick={() => { setPending(null); setReason(""); }}>Cancel</Button>
        </div>
      )}
      {(order.driver || showHistory) && (
        <div className="text-xs">
          <button type="button" className="text-primary underline underline-offset-2" onClick={() => setShowHistory((v) => !v)}>{showHistory ? "Hide rider history" : "Rider history"}</button>
          {showHistory && (
            <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
              {(history ?? []).length === 0 && <li>No rider changes yet.</li>}
              {(history ?? []).map((h) => (
                <li key={h.id}>{time(h.at)} · {h.from ?? "Unassigned"} → {h.to ?? "Unassigned"} · by {h.by}{h.reason ? ` · ${h.reason}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function ZonesTab({ branchId }: { branchId: string | null }) {
  const { data: zones, isLoading } = useZones(branchId);
  const { create, remove, update } = useZoneActions(branchId);
  const [form, setForm] = useState({ name: "", fee: "40", minOrderAmount: "0", etaMinutes: "45", pincodes: "" });

  const submit = () => {
    const pincodes = form.pincodes.split(/[\s,]+/).filter(Boolean);
    if (!form.name.trim() || pincodes.length === 0) return toast.error("Enter a name and at least one pincode");
    create.mutate(
      {
        name: form.name.trim(),
        fee: form.fee,
        minOrderAmount: form.minOrderAmount,
        etaMinutes: Number(form.etaMinutes),
        pincodes,
        isActive: true,
      },
      {
        onSuccess: () => {
          toast.success("Zone added");
          setForm({ ...form, name: "", pincodes: "" });
        },
        onError: (e) => toast.error(errMsg(e)),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Input placeholder="Zone name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="Fee" inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
        <Input placeholder="Min order" inputMode="decimal" value={form.minOrderAmount} onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value })} />
        <Input placeholder="ETA (min)" inputMode="numeric" value={form.etaMinutes} onChange={(e) => setForm({ ...form, etaMinutes: e.target.value })} />
        <Input placeholder="Pincodes, comma separated" value={form.pincodes} onChange={(e) => setForm({ ...form, pincodes: e.target.value })} />
        <div className="sm:col-span-2 lg:col-span-5">
          <Button onClick={submit} disabled={create.isPending}>Add zone</Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Until you add a zone, delivery orders are accepted from anywhere with no fee. Once a zone exists, only
            its pincodes can order delivery.
          </p>
        </div>
      </Card>
      <Card className="flex flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : zones && zones.length > 0 ? (
          zones.map((z) => (
            <div key={z.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className={cn("font-medium", !z.isActive && "text-muted-foreground line-through")}>{z.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(z.fee)} fee · min {formatCurrency(z.minOrderAmount)} · {z.etaMinutes} min ·{" "}
                  {z.pincodes.join(", ")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate({ id: z.id, dto: { isActive: !z.isActive } }, { onError: (e) => toast.error(errMsg(e)) })}
                >
                  {z.isActive ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirm(`Delete zone ${z.name}?`) && remove.mutate(z.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">No delivery zones yet.</p>
        )}
      </Card>
    </div>
  );
}

function RidersPanel({ branchId }: { branchId: string | null }) {
  const { data: drivers, dataUpdatedAt } = useDrivers(branchId);
  if (!drivers || drivers.length === 0) return null;
  const ago = (iso: string | null) => {
    if (!iso) return "no location yet";
    const m = Math.max(Math.round((dataUpdatedAt - new Date(iso).getTime()) / 60_000), 0);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  return (
    <section aria-labelledby="riders-h" className="flex flex-col gap-2">
      <h2 id="riders-h" className="text-sm font-medium text-foreground">
        Riders ({drivers.filter((d) => d.riderOnline).length} online)
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {drivers.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                <span className={d.riderOnline ? "text-success" : "text-muted-foreground"} aria-hidden>
                  ●
                </span>{" "}
                {d.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {d.riderOnline ? "Online" : "Offline"} · {d.activeDeliveries} active
                {d.riderOnline && ` · ${ago(d.riderLocationAt)}`}
              </p>
            </div>
            {d.riderOnline && d.riderLat != null && d.riderLng != null && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${d.riderLat},${d.riderLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-primary underline underline-offset-2"
              >
                Map
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DeliveryPage() {
  const { branchId } = useBranch();
  const [tab, setTab] = useState<"active" | "history" | "zones">("active");
  const { data: orders, isLoading } = useDeliveries(branchId, tab === "history");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Delivery</h1>
        <p className="text-sm text-muted-foreground">Assign drivers, track deliveries, and manage zones</p>
      </div>
      <RidersPanel branchId={branchId} />
      <div className="flex gap-2">
        {(["active", "history", "zones"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-xs capitalize transition-colors",
              tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-secondary",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "zones" ? (
        <ZonesTab branchId={branchId} />
      ) : isLoading ? (
        <Skeleton className="h-24" />
      ) : orders && orders.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((o) => (
            <DeliveryCard key={o.id} order={o} branchId={branchId} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {tab === "active" ? "No active deliveries." : "No completed deliveries yet."}
        </Card>
      )}
    </div>
  );
}
