"use client";

import { Bike, CheckCircle2, ChefHat, MapPin, Navigation, Phone, ShoppingBag, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  playNewDeliveryAlert,
  sendRiderLocation,
  useRiderActions,
  useRiderDeliveries,
  useRiderMe,
  type RiderCard,
} from "@/hooks/use-rider";
import { ApiError } from "@/lib/api";
import { isNativeApp, plugin } from "@/lib/native";

interface NativeGeo {
  requestPermissions: () => Promise<{ location: string; coarseLocation: string }>;
  watchPosition: (
    o: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
    cb: (pos: { coords: { latitude: number; longitude: number } } | null, err?: unknown) => void,
  ) => Promise<string>;
  clearWatch: (o: { id: string }) => Promise<void>;
}

const money = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
const FAIL_REASONS = ["Customer not reachable", "Wrong or incomplete address", "Customer refused the order", "Could not find the place"];

/** Shares the phone's position every ~20 s while the rider is on duty. */
function useLiveLocation(online: boolean) {
  const [state, setState] = useState<"off" | "ok" | "denied" | "unavailable">("off");
  const last = useRef(0);
  useEffect(() => {
    if (!online) return;
    const report = (lat: number, lng: number) => {
      setState("ok");
      if (Date.now() - last.current < 20_000) return;
      last.current = Date.now();
      void sendRiderLocation(lat, lng);
    };

    // In the phone app use the native location plugin: web geolocation is blocked
    // on a plain-http restaurant server, which is the usual case on a local network.
    const native = plugin<NativeGeo>("Geolocation");
    if (isNativeApp() && native) {
      let watchId: string | null = null;
      let stopped = false;
      void (async () => {
        try {
          const perm = await native.requestPermissions();
          if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
            if (!stopped) setState("denied");
            return;
          }
          const id = await native.watchPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 }, (pos, err) => {
            if (err || !pos) return setState("unavailable");
            report(pos.coords.latitude, pos.coords.longitude);
          });
          if (stopped) void native.clearWatch({ id });
          else watchId = id;
        } catch {
          if (!stopped) setState("denied");
        }
      })();
      return () => {
        stopped = true;
        if (watchId) void native.clearWatch({ id: watchId });
      };
    }

    if (!("geolocation" in navigator)) {
      const t = setTimeout(() => setState("unavailable"), 0);
      return () => clearTimeout(t);
    }
    const id = navigator.geolocation.watchPosition(
      (p) => report(p.coords.latitude, p.coords.longitude),
      (err) => setState(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [online]);
  // Off duty means nothing is being shared, whatever the last state was.
  return online ? state : "off";
}

function DeliveryCard({ c, busy, onStatus }: { c: RiderCard; busy: boolean; onStatus: (s: "PICKED_UP" | "DELIVERED" | "FAILED", reason?: string) => void }) {
  const [failing, setFailing] = useState(false);
  const toPickup = c.status === "ASSIGNED";
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Order #{c.orderNumber.split("-").pop()}</h3>
        <Badge variant={toPickup ? "secondary" : "default"}>{toPickup ? "Go to restaurant" : "Deliver to customer"}</Badge>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{c.pickup.name}</p>
          {c.pickup.address && <p className="text-muted-foreground">{c.pickup.address}</p>}
          <p className={`mt-0.5 inline-flex items-center gap-1 text-xs ${c.foodReady ? "text-success" : "text-warning"}`}>
            <ChefHat className="h-3.5 w-3.5" aria-hidden />
            {c.foodReady ? "Food is ready" : "Food is being prepared"}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{c.customer.name ?? "Customer"}</p>
          <p className="break-words text-muted-foreground">
            {c.address}
            {c.pincode ? `, ${c.pincode}` : ""}
          </p>
          {c.location.place && <p className="break-words text-foreground">Landmark: {c.location.place}</p>}
          {c.location.lat != null && <p className="text-xs text-success">Customer shared their exact location</p>}
        </div>
      </div>

      <ul className="rounded-lg bg-secondary/50 px-3 py-2 text-sm">
        {c.items.map((i, idx) => (
          <li key={idx} className="flex justify-between gap-2">
            <span className="min-w-0 break-words">{i.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">× {i.quantity}</span>
          </li>
        ))}
      </ul>
      {c.notes && <p className="text-xs text-muted-foreground">Note: {c.notes}</p>}

      <p className={`rounded-lg px-3 py-2 text-sm font-medium ${c.amountToCollect > 0 ? "bg-warning/15 text-foreground" : "bg-success/15 text-foreground"}`}>
        {c.amountToCollect > 0 ? `Collect ${money(c.amountToCollect)} from the customer` : "Already paid. Collect nothing."}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <a
          href={c.location.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonVariants({ variant: "outline" })} h-11`}
        >
          <Navigation className="mr-2 h-4 w-4" aria-hidden />
          Navigate
        </a>
        {c.customer.phone ? (
          <a href={`tel:${c.customer.phone}`} className={`${buttonVariants({ variant: "outline" })} h-11`}>
            <Phone className="mr-2 h-4 w-4" aria-hidden />
            Call customer
          </a>
        ) : (
          <Button variant="outline" className="h-11" disabled>
            No phone
          </Button>
        )}
      </div>

      {toPickup ? (
        <Button className="h-12 text-base" disabled={busy} onClick={() => onStatus("PICKED_UP")}>
          Picked up the order
        </Button>
      ) : failing ? (
        <div className="flex flex-col gap-2" role="group" aria-label="Why could it not be delivered?">
          <p className="text-sm font-medium text-foreground">Why could it not be delivered?</p>
          {FAIL_REASONS.map((r) => (
            <Button key={r} variant="outline" className="h-11 justify-start" disabled={busy} onClick={() => onStatus("FAILED", r)}>
              {r}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setFailing(false)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button className="h-12 text-base" disabled={busy} onClick={() => onStatus("DELIVERED")}>
            Delivered{c.amountToCollect > 0 ? ` · cash ${money(c.amountToCollect)} collected` : ""}
          </Button>
          <Button variant="outline" className="h-12" aria-label="Could not deliver" disabled={busy} onClick={() => setFailing(true)}>
            <XCircle className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function MyDeliveriesPage() {
  const me = useRiderMe();
  const online = !!me.data?.online;
  const deliveries = useRiderDeliveries(!!me.data);
  const { duty, status } = useRiderActions();
  const gps = useLiveLocation(online);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // Alert on a delivery that was not on screen before (not on the first load).
  const activeIds = deliveries.data?.active.map((c) => c.id) ?? [];
  const key = activeIds.join(",");
  useEffect(() => {
    if (!deliveries.data) return;
    const now = new Set(activeIds);
    if (seen.current) {
      for (const id of now) {
        if (!seen.current.has(id)) {
          playNewDeliveryAlert();
          break;
        }
      }
    }
    seen.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, deliveries.data]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");

  if (me.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {me.error instanceof ApiError ? me.error.message : "Could not load your deliveries."}
      </p>
    );
  }
  if (me.isLoading || !me.data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  const d = me.data;
  const active = deliveries.data?.active ?? [];
  const done = deliveries.data?.done ?? [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">My deliveries</h1>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {d.name} · {d.location.name}
        </p>
      </div>

      <div className={`flex items-center justify-between rounded-2xl px-4 py-3 ${online ? "bg-success/15" : "bg-secondary"}`}>
        <div>
          <p className="text-sm font-semibold text-foreground">{online ? "You are online" : "You are offline"}</p>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {!online && "Go online to get deliveries"}
            {online && gps === "ok" && "Sharing your live location"}
            {online && gps === "denied" && "Allow location access so the restaurant can see you"}
            {online && gps === "unavailable" && "Location is not available on this device"}
            {online && gps === "off" && "Starting location…"}
          </p>
        </div>
        <Switch
          aria-label="Go online"
          checked={online}
          disabled={duty.isPending}
          onCheckedChange={(v) => {
            setError(null);
            duty.mutate(v, { onError: fail });
          }}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Active", d.today.active],
          ["Delivered today", d.today.delivered],
          ["Failed today", d.today.failed],
        ].map(([label, n]) => (
          <div key={String(label)} className="rounded-xl border border-border p-3">
            <dd className="text-2xl font-semibold tabular-nums text-foreground">{n}</dd>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>

      <section aria-labelledby="rd-active" className="flex flex-col gap-3">
        <h2 id="rd-active" className="text-base font-semibold text-foreground">
          Your deliveries
        </h2>
        {deliveries.isLoading ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : active.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
            <Bike className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">{online ? "Waiting for your next delivery" : "No deliveries right now"}</p>
            <p className="text-xs text-muted-foreground">
              {online ? "New orders appear here with a sound." : "Switch on “You are online” to receive orders."}
            </p>
          </div>
        ) : (
          active.map((c) => (
            <DeliveryCard
              key={c.id}
              c={c}
              busy={status.isPending}
              onStatus={(s, reason) => {
                setError(null);
                status.mutate({ id: c.id, status: s, reason }, { onError: fail });
              }}
            />
          ))
        )}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="rd-done" className="flex flex-col gap-2">
          <h2 id="rd-done" className="text-base font-semibold text-foreground">
            Done today
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {done.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  #{c.orderNumber.split("-").pop()} · {c.customer.name ?? "Customer"}
                </span>
                <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${c.status === "DELIVERED" ? "text-success" : "text-destructive"}`}>
                  {c.status === "DELIVERED" ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
                  {c.status === "DELIVERED" ? "Delivered" : "Failed"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
