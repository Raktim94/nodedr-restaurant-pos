"use client";

import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CartLine } from "@/components/pos/cart-line";
import { SavedAddressPicker } from "@/components/pos/saved-address-picker";
import type { RestaurantTable } from "@/hooks/use-tables";
import { formatCurrency } from "@/lib/format";
import { subtotalOf } from "@/lib/pricing-preview";

export type PosOrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
export interface DeliveryDetails {
  address: string;
  pincode: string;
  phone: string;
}

export function CartPanel({
  lines,
  orderType,
  onOrderTypeChange,
  tables,
  tableId,
  onTableChange,
  onIncrement,
  onDecrement,
  onRemove,
  onSubmit,
  isSubmitting,
  existingOrderNumber,
  onViewExistingOrder,
  openBills,
  selectedBillId,
  onSelectBill,
  checkingTable = false,
  delivery,
  onDeliveryChange,
  scheduledFor,
  onScheduledForChange,
  branchId = null,
}: {
  lines: CartLine[];
  orderType: PosOrderType;
  onOrderTypeChange: (type: PosOrderType) => void;
  tables: RestaurantTable[];
  tableId: string;
  onTableChange: (id: string) => void;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  existingOrderNumber?: string;
  onViewExistingOrder?: () => void;
  /** All unpaid bills on the selected table (more than one is possible). */
  openBills?: { id: string; orderNumber: string }[];
  selectedBillId?: string | null;
  onSelectBill?: (id: string) => void;
  /** The table's open bills are still loading - sending now could start a duplicate bill. */
  checkingTable?: boolean;
  delivery: DeliveryDetails;
  onDeliveryChange: (d: DeliveryDetails) => void;
  scheduledFor: string;
  onScheduledForChange: (v: string) => void;
  /** Used to look up a returning customer's saved addresses by phone. */
  branchId?: string | null;
}) {
  const subtotal = subtotalOf(lines.map((l) => l.unitPrice * l.quantity));
  const deliveryReady =
    orderType !== "DELIVERY" ||
    (delivery.address.trim().length >= 5 && delivery.pincode.trim().length >= 3 && delivery.phone.trim().length >= 6);
  const canSubmit =
    lines.length > 0 && (orderType !== "DINE_IN" || !!tableId) && deliveryReady && !isSubmitting && !checkingTable;

  return (
    <div className="flex h-full flex-col justify-between overflow-hidden gap-3">
      <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
        {/* Apple HIG Segmented Control */}
        <Tabs value={orderType} onValueChange={(v) => onOrderTypeChange(v as PosOrderType)} className="shrink-0">
          <TabsList className="w-full h-11 sm:h-9 rounded-xl bg-muted/70 p-1 border border-border/50">
            <TabsTrigger
              value="TAKEAWAY"
              className="flex-1 rounded-lg text-xs font-semibold text-foreground transition-all duration-150 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs min-h-[34px] sm:min-h-0"
            >
              Takeaway
            </TabsTrigger>
            <TabsTrigger
              value="DINE_IN"
              className="flex-1 rounded-lg text-xs font-semibold text-foreground transition-all duration-150 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs min-h-[34px] sm:min-h-0"
            >
              Dine-in
            </TabsTrigger>
            <TabsTrigger
              value="DELIVERY"
              className="flex-1 rounded-lg text-xs font-semibold text-foreground transition-all duration-150 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs min-h-[34px] sm:min-h-0"
            >
              Delivery
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {orderType === "DINE_IN" && (
          <Select value={tableId} onValueChange={(v) => onTableChange(v ?? "")}>
            <SelectTrigger className="w-full h-11 sm:h-9 rounded-xl text-xs sm:text-sm font-medium">
              <SelectValue placeholder="Select table">
                {(value: string | null) => {
                  const t = tables.find((table) => table.id === value);
                  if (!t) return "Select table";
                  return `${t.name ?? `Table ${t.number}`}${t.status === "OCCUPIED" ? " (occupied)" : ""}`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {tables.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs sm:text-sm">
                  {t.name ?? `Table ${t.number}`} {t.status === "OCCUPIED" ? "(occupied)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {orderType === "DELIVERY" && (
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Delivery address"
              className="h-11 sm:h-9 rounded-xl text-xs sm:text-sm"
              value={delivery.address}
              onChange={(e) => onDeliveryChange({ ...delivery, address: e.target.value })}
            />
            <SavedAddressPicker
              branchId={branchId}
              phone={delivery.phone}
              onPick={(address, pincode) => onDeliveryChange({ ...delivery, address, pincode })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Pincode"
                inputMode="numeric"
                className="h-11 sm:h-9 rounded-xl text-xs sm:text-sm tabular-nums"
                value={delivery.pincode}
                onChange={(e) => onDeliveryChange({ ...delivery, pincode: e.target.value })}
              />
              <Input
                placeholder="Phone"
                inputMode="tel"
                className="h-11 sm:h-9 rounded-xl text-xs sm:text-sm tabular-nums"
                value={delivery.phone}
                onChange={(e) => onDeliveryChange({ ...delivery, phone: e.target.value })}
              />
            </div>
          </div>
        )}

        {orderType !== "DINE_IN" && (
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
            Schedule for later (optional)
            <Input
              type="datetime-local"
              className="h-11 sm:h-9 rounded-xl text-xs sm:text-sm tabular-nums font-medium"
              value={scheduledFor}
              onChange={(e) => onScheduledForChange(e.target.value)}
            />
          </label>
        )}

        {checkingTable && (
          <p role="status" className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground border border-border/60">
            Checking this table&apos;s open bills…
          </p>
        )}
        {openBills && openBills.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-muted/30 border border-border/50 text-xs text-muted-foreground" role="group" aria-label="Open bills on this table">
            <span className="font-medium">{openBills.length} open bills:</span>
            {openBills.map((b) => (
              <Button
                key={b.id}
                type="button"
                size="sm"
                variant={b.id === selectedBillId ? "default" : "outline"}
                className="h-8 px-2.5 text-xs rounded-lg font-semibold"
                aria-pressed={b.id === selectedBillId}
                onClick={() => onSelectBill?.(b.id)}
              >
                #{b.orderNumber}
              </Button>
            ))}
          </div>
        )}
        {existingOrderNumber && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/70 p-3 text-xs text-muted-foreground border border-border/60">
            <span>
              Table has open order{" "}
              <strong className="font-bold text-foreground">#{existingOrderNumber}</strong>
              {lines.length > 0 && " — items will be added to it."}
            </span>
            {onViewExistingOrder && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs rounded-lg font-semibold active:scale-98"
                onClick={onViewExistingOrder}
              >
                View & pay
              </Button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1 scrollbar-none">
          {lines.length === 0 ? (
            <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/80">
                <ShoppingCart className="h-6 w-6 opacity-40 text-muted-foreground" />
              </div>
              <p className="text-xs font-semibold">Cart is currently empty</p>
              <p className="text-[11px] text-muted-foreground">Tap any dish on the left to add</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border/60">
              {lines.map((line) => (
                <div key={line.key} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground leading-snug">{line.name}</p>
                    {line.modifierLabel && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{line.modifierLabel}</p>
                    )}
                    <p className="mt-1 text-xs font-bold tabular-nums text-primary">
                      {formatCurrency(line.unitPrice * line.quantity)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 bg-secondary/50 rounded-xl p-1 border border-border/40">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Decrease quantity of ${line.name}`}
                      className="h-8 w-8 rounded-lg text-foreground hover:bg-card active:scale-95"
                      onClick={() => onDecrement(line.key)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center text-xs font-bold tabular-nums">{line.quantity}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Increase quantity of ${line.name}`}
                      className="h-8 w-8 rounded-lg text-foreground hover:bg-card active:scale-95"
                      onClick={() => onIncrement(line.key)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${line.name}`}
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95"
                      onClick={() => onRemove(line.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border pt-3.5 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">Subtotal (incl. tax)</span>
            <span className="font-extrabold text-sm sm:text-base tabular-nums text-foreground">
              {formatCurrency(subtotal)}
            </span>
          </div>
          <Button
            className="h-11 w-full rounded-xl bg-primary text-primary-foreground font-bold shadow-xs transition active:scale-[0.98] disabled:opacity-50 text-xs sm:text-sm"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {isSubmitting
              ? "Sending to kitchen…"
              : existingOrderNumber
                ? "Add to order & send"
                : "Send to kitchen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
