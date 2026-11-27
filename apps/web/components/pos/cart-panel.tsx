"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { PauseBadge } from "@/components/menu/pause-badge";
import { useI18n } from "@/lib/i18n/context";
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
import { cartLineName, type CartLine } from "@/components/pos/cart-line";
import { SavedAddressPicker } from "@/components/pos/saved-address-picker";
import type { RestaurantTable } from "@/hooks/use-tables";
import { subtotalOf } from "@/lib/pricing-preview";

export type PosOrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY";
export interface DeliveryDetails {
  address: string;
  pincode: string;
  phone: string;
}

export function CartPanel({
  lines,
  pauseLabels,
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
  taxMode = "INCLUSIVE",
  ticketMode = "KDS",
}: {
  lines: CartLine[];
  pauseLabels: ReadonlyMap<string, string>;
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
  /** EXCLUSIVE branches show a pre-tax-free subtotal: prices are grossed up in addLine. */
  taxMode?: "INCLUSIVE" | "EXCLUSIVE";
  /** BILL_ONLY branches create no kitchen ticket: the order is a bill only. */
  ticketMode?: "KDS" | "BILL_ONLY";
}) {
  const fmt = useStaffFormat();
  const { t: translate, t } = useI18n();
  const hasPaused = lines.some((line) => pauseLabels.has(line.menuItemId));
  const subtotal = subtotalOf(lines.map((l) => l.unitPrice * l.quantity));
  const deliveryReady =
    orderType !== "DELIVERY" ||
    (delivery.address.trim().length >= 5 && delivery.pincode.trim().length >= 3 && delivery.phone.trim().length >= 6);
  const canSubmit =
    lines.length > 0 && !hasPaused && (orderType !== "DINE_IN" || !!tableId) && deliveryReady && !isSubmitting && !checkingTable;

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs value={orderType} onValueChange={(v) => onOrderTypeChange(v as PosOrderType)}>
        <TabsList className="w-full">
          <TabsTrigger value="TAKEAWAY" className="flex-1">
            {translate("Takeaway")}
          </TabsTrigger>
          <TabsTrigger value="DINE_IN" className="flex-1">
            {translate("Dine-in")}
          </TabsTrigger>
          <TabsTrigger value="DELIVERY" className="flex-1">
            {translate("Delivery")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {orderType === "DINE_IN" && (
        <Select value={tableId} onValueChange={(v) => onTableChange(v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={translate("Select table")}>
              {(value: string | null) => {
                const t = tables.find((table) => table.id === value);
                if (!t) return translate("Select table");
                return `${t.name ?? `Table ${t.number}`}${t.status === "OCCUPIED" ? " (occupied)" : ""}`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name ?? translate("Table {number}", { number: t.number })} {t.status === "OCCUPIED" ? translate("(occupied)") : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {orderType === "DELIVERY" && (
        <div className="flex flex-col gap-2">
          <Input
            aria-label={translate("Delivery address")}
            placeholder={translate("Delivery address")}
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
              aria-label={translate("Pincode")}
              placeholder={translate("Pincode")}
              inputMode="numeric"
              value={delivery.pincode}
              onChange={(e) => onDeliveryChange({ ...delivery, pincode: e.target.value })}
            />
            <Input
              aria-label={translate("Delivery phone number")}
              placeholder={translate("Phone")}
              inputMode="tel"
              value={delivery.phone}
              onChange={(e) => onDeliveryChange({ ...delivery, phone: e.target.value })}
            />
          </div>
          {!deliveryReady && (
            <p role="alert" className="text-xs text-muted-foreground">
              {translate("Add an address (5+ characters), pincode (3+) and phone number (6+) to send this order.")}
            </p>
          )}
        </div>
      )}

      {orderType !== "DINE_IN" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {translate("Schedule for later (optional)")}
          <Input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => onScheduledForChange(e.target.value)}
          />
        </label>
      )}

      {checkingTable && (
        <p role="status" className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {translate("Checking this table's open bills…")}
        </p>
      )}
      {openBills && openBills.length >= 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="group" aria-label={translate("Open bills on this table")}>
          <span>{translate("{count} open bills here — add to:", { count: openBills.length })}</span>
          {openBills.map((b) => (
            <Button
              key={b.id}
              type="button"
              size="sm"
              variant={b.id === selectedBillId ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              aria-pressed={b.id === selectedBillId}
              onClick={() => onSelectBill?.(b.id)}
            >
              #{b.orderNumber}
            </Button>
          ))}
        </div>
      )}
      {existingOrderNumber && (
        <div className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          <span>{translate("This table already has open order")} <span className="font-medium text-foreground">#{existingOrderNumber}</span>
            {lines.length > 0 && translate(" — these items will be added to it as a new round.")}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <ShoppingCart className="h-8 w-8 opacity-40" />
            <p className="text-sm">{translate("Cart is empty")}</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {lines.map((line) => {
              const name = cartLineName(line, translate);
              return (
                <div key={line.key} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{name}</p>
                    <PauseBadge label={pauseLabels.get(line.menuItemId)} />
                    {line.modifierLabel && (
                      <p className="text-xs text-muted-foreground">{line.modifierLabel}</p>
                    )}
                    <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                      {fmt.currency(line.unitPrice * line.quantity)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={translate("Remove one {name}", { name })}
                      onClick={() => onDecrement(line.key)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums" aria-label={translate("Quantity")}>{line.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={translate("Add one {name}", { name })}
                      disabled={pauseLabels.has(line.menuItemId)}
                      onClick={() => onIncrement(line.key)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                      aria-label={translate("Delete {name} from cart", { name })}
                      onClick={() => onRemove(line.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {taxMode === "EXCLUSIVE" ? translate("Subtotal (tax added on bill)") : translate("Subtotal (incl. tax)")}
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            {fmt.currency(subtotal)}
          </span>
        </div>
        {hasPaused && <p role="status" className="text-sm text-warning">{t("menu.removePaused")}</p>}
        <Button className="h-11 w-full" disabled={!canSubmit} onClick={onSubmit}>
          {isSubmitting
            ? translate(ticketMode === "BILL_ONLY" ? "Saving bill…" : "Sending to kitchen…")
            : existingOrderNumber
              ? translate(ticketMode === "BILL_ONLY" ? "Add to order & save bill" : "Add to order & send to kitchen")
              : translate(ticketMode === "BILL_ONLY" ? "Save bill" : "Send to kitchen")}
        </Button>
        {onViewExistingOrder && existingOrderNumber && (
          <Button type="button" variant="outline" className="h-11 w-full" onClick={onViewExistingOrder}>{translate("View bill #{existingOrderNumber} & take payment", { existingOrderNumber })}</Button>
        )}
      </div>
    </div>
  );
}
