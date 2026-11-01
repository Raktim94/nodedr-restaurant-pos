"use client";

import { MapPin, Navigation } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DeliveryWhereOrder {
  type?: string;
  deliveryAddress?: string | null;
  deliveryPincode?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  deliveryPlace?: string | null;
}

/** Google Maps link for the customer's shared GPS fix, or a search on the typed address. */
export function mapsLink(o: DeliveryWhereOrder): string | null {
  if (o.deliveryLat != null && o.deliveryLng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${o.deliveryLat},${o.deliveryLng}`;
  }
  const text = [o.deliveryAddress, o.deliveryPincode].filter(Boolean).join(" ");
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}

export function hasDeliveryWhere(o: DeliveryWhereOrder) {
  return !!(o.deliveryAddress || o.deliveryLat != null || o.deliveryPlace);
}

/** Where to deliver: address, landmark and a Google Maps link. Shown wherever staff accept or manage an order. */
export function DeliveryWhere({ order }: { order: DeliveryWhereOrder }) {
  if (!hasDeliveryWhere(order)) return null;
  const href = mapsLink(order);
  const pinned = order.deliveryLat != null && order.deliveryLng != null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deliver to</div>
      {order.deliveryAddress && (
        <p className="flex items-start gap-2 text-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {order.deliveryAddress}
            {order.deliveryPincode ? ` · ${order.deliveryPincode}` : ""}
          </span>
        </p>
      )}
      {order.deliveryPlace && (
        <p className="text-xs text-muted-foreground">Landmark: {order.deliveryPlace}</p>
      )}
      {pinned && (
        <p className="text-xs text-muted-foreground">The customer shared their live location.</p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
        >
          <Navigation className="mr-1.5 h-4 w-4" /> Open in Google Maps
        </a>
      )}
    </div>
  );
}
