"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CartPanel } from "@/components/pos/cart-panel";
import { cartLineKey, type CartLine } from "@/components/pos/cart-line";
import { CheckoutPanel } from "@/components/pos/checkout-panel";
import { ModifierPickerDialog } from "@/components/pos/modifier-picker-dialog";
import { ProductGrid } from "@/components/pos/product-grid";
import { Card } from "@/components/ui/card";
import { useBranch } from "@/hooks/use-branch";
import type { MenuItem } from "@/hooks/use-menu";
import { useCreateOrder, type CreatedOrder } from "@/hooks/use-orders";
import { useFloors } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export default function PosPage() {
  const { branchId } = useBranch();
  const { data: floors } = useFloors(branchId);
  const tables = floors?.flatMap((f) => f.tables) ?? [];

  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [tableId, setTableId] = useState("");
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [activeOrder, setActiveOrder] = useState<CreatedOrder | null>(null);

  const createOrder = useCreateOrder(branchId);

  const addLine = (menuItemId: string, name: string, unitPrice: number, modifierIds: string[], modifierLabel: string) => {
    const key = cartLineKey(menuItemId, modifierIds);
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key, menuItemId, name, unitPrice, quantity: 1, modifierIds, modifierLabel }];
    });
  };

  const handleSelect = (item: MenuItem) => {
    if (item.modifierGroups.length > 0) {
      setPickerItem(item);
      return;
    }
    addLine(item.id, item.name, Number(item.price), [], "");
  };

  const handleModifierConfirm = (modifierIds: string[], modifierLabel: string) => {
    if (!pickerItem) return;
    const modifierTotal = modifierIds.reduce((sum, id) => {
      const mod = pickerItem.modifierGroups
        .flatMap((g) => g.modifierGroup.modifiers)
        .find((m) => m.id === id);
      return sum + (mod ? Number(mod.priceAdjustment) : 0);
    }, 0);
    addLine(
      pickerItem.id,
      pickerItem.name,
      Number(pickerItem.price) + modifierTotal,
      modifierIds,
      modifierLabel,
    );
  };

  const updateQuantity = (key: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  };

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const handleSubmit = () => {
    createOrder.mutate(
      {
        type: orderType,
        tableId: orderType === "DINE_IN" ? tableId : undefined,
        items: lines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          modifierIds: l.modifierIds,
        })),
      },
      {
        onSuccess: (order) => {
          setActiveOrder(order);
          toast.success(`Order #${order.orderNumber} sent to kitchen`);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create order"),
      },
    );
  };

  const resetForNewOrder = () => {
    setActiveOrder(null);
    setLines([]);
    setTableId("");
  };

  return (
    <div className="grid h-[calc(100vh-8rem)] grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden p-5">
        <ProductGrid branchId={branchId} onSelect={handleSelect} />
      </Card>

      <Card className="overflow-hidden p-5">
        {activeOrder ? (
          <CheckoutPanel order={activeOrder} branchId={branchId} onDone={resetForNewOrder} />
        ) : (
          <CartPanel
            lines={lines}
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            tables={tables}
            tableId={tableId}
            onTableChange={setTableId}
            onIncrement={(key) => updateQuantity(key, 1)}
            onDecrement={(key) => updateQuantity(key, -1)}
            onRemove={removeLine}
            onSubmit={handleSubmit}
            isSubmitting={createOrder.isPending}
          />
        )}
      </Card>

      <ModifierPickerDialog
        item={pickerItem}
        open={!!pickerItem}
        onOpenChange={(open) => !open && setPickerItem(null)}
        onConfirm={handleModifierConfirm}
      />
    </div>
  );
}
