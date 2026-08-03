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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CartLine } from "@/components/pos/cart-line";
import { CustomerPicker } from "@/components/pos/customer-picker";
import type { Customer } from "@/hooks/use-customers";
import type { RestaurantTable } from "@/hooks/use-tables";
import { formatCurrency } from "@/lib/format";
import { subtotalOf } from "@/lib/pricing-preview";

export function CartPanel({
  branchId,
  lines,
  orderType,
  onOrderTypeChange,
  tables,
  tableId,
  onTableChange,
  customer,
  onCustomerChange,
  onIncrement,
  onDecrement,
  onRemove,
  onSubmit,
  isSubmitting,
}: {
  branchId: string | null;
  lines: CartLine[];
  orderType: "DINE_IN" | "TAKEAWAY";
  onOrderTypeChange: (type: "DINE_IN" | "TAKEAWAY") => void;
  tables: RestaurantTable[];
  tableId: string;
  onTableChange: (id: string) => void;
  customer: Customer | null;
  onCustomerChange: (customer: Customer | null) => void;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const subtotal = subtotalOf(lines.map((l) => l.unitPrice * l.quantity));
  const canSubmit = lines.length > 0 && (orderType === "TAKEAWAY" || !!tableId) && !isSubmitting;

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs value={orderType} onValueChange={(v) => onOrderTypeChange(v as "DINE_IN" | "TAKEAWAY")}>
        <TabsList className="w-full">
          <TabsTrigger value="DINE_IN" className="flex-1">
            Dine-in
          </TabsTrigger>
          <TabsTrigger value="TAKEAWAY" className="flex-1">
            Takeaway
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {orderType === "DINE_IN" && (
        <Select value={tableId} onValueChange={(v) => onTableChange(v ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select table" />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t.id} value={t.id} disabled={t.status === "OCCUPIED"}>
                {t.name ?? `Table ${t.number}`} {t.status === "OCCUPIED" ? "(occupied)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <CustomerPicker branchId={branchId} customer={customer} onSelect={onCustomerChange} />

      <div className="flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <ShoppingCart className="h-8 w-8 opacity-40" />
            <p className="text-sm">Cart is empty</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {lines.map((line) => (
              <div key={line.key} className="flex items-start justify-between gap-3 py-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{line.name}</p>
                  {line.modifierLabel && (
                    <p className="text-xs text-muted-foreground">{line.modifierLabel}</p>
                  )}
                  <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                    {formatCurrency(line.unitPrice * line.quantity)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onDecrement(line.key)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-5 text-center text-sm tabular-nums">{line.quantity}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onIncrement(line.key)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
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

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal (incl. tax)</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatCurrency(subtotal)}
          </span>
        </div>
        <Button className="h-11" disabled={!canSubmit} onClick={onSubmit}>
          {isSubmitting ? "Sending to kitchen…" : "Send to kitchen"}
        </Button>
      </div>
    </div>
  );
}
