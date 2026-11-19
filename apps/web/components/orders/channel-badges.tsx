import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Online = guest ordered via website/QR; Offline = entered by staff.
export function ChannelBadge({ channel }: { channel: "STAFF" | "ONLINE" }) {
  const online = channel === "ONLINE";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded-md",
        online ? "bg-primary/15 text-primary border border-primary/20" : "bg-secondary text-muted-foreground border border-border/60",
      )}
    >
      {online ? "Online" : "Offline"}
    </Badge>
  );
}

export const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  DRIVE_THRU: "Drive-thru",
  QR_ORDER: "QR order",
  KIOSK: "Kiosk",
  PHONE: "Phone",
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="secondary" className="text-[10px] sm:text-[11px] font-medium px-2 py-0.5 rounded-md border border-border/50 bg-secondary/80 text-foreground">
      {ORDER_TYPE_LABEL[type] ?? type.replace("_", " ")}
    </Badge>
  );
}
