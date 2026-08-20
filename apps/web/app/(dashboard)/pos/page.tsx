"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { CartPanel } from "@/components/pos/cart-panel";
import { cartLineKey, type CartLine } from "@/components/pos/cart-line";
import { CheckoutPanel } from "@/components/pos/checkout-panel";
import { KitchenProgressWidget } from "@/components/pos/kitchen-progress-widget";
import { ModifierPickerDialog } from "@/components/pos/modifier-picker-dialog";
import { PosTablePicker } from "@/components/pos/pos-table-picker";
import { ProductGrid } from "@/components/pos/product-grid";
import { Card } from "@/components/ui/card";
import { useBranch } from "@/hooks/use-branch";
import type { MenuItem } from "@/hooks/use-menu";
import {
  useAddOrderItems,
  useCreateOrder,
  useOpenOrdersForTable,
  type CreatedOrder,
} from "@/hooks/use-orders";
import { useFloors, type RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export default function PosPage() {
  return (
    <Suspense fallback={null}>
      <PosPageInner />
    </Suspense>
  );
}

function PosPageInner() {
  const { branchId } = useBranch();
  const { data: floors } = useFloors(branchId);
  const tables = floors?.flatMap((f) => f.tables) ?? [];
  const preselectedTableId = useSearchParams().get("tableId") ?? "";

  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY">("DINE_IN");
  const [tableId, setTableId] = useState(preselectedTableId);
  const [pickerItem, setPickerItem] = useState<MenuItem | null>(null);
  const [activeOrder, setActiveOrder] = useState<CreatedOrder | null>(null);

  const createOrder = useCreateOrder(branchId);
  const addOrderItems = useAddOrderItems(branchId);
  const { data: existingOrders } = useOpenOrdersForTable(
    branchId,
    orderType === "DINE_IN" ? tableId || null : null,
  );
  const existingOrder = existingOrders?.[0];

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
    const items = lines.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      modifierIds: l.modifierIds,
    }));

    if (existingOrder) {
      addOrderItems.mutate(
        { orderId: existingOrder.id, dto: { items } },
        {
          onSuccess: (order) => {
            setActiveOrder(order);
            toast.success(`Added to order #${order.orderNumber} — sent to kitchen`);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add items"),
        },
      );
      return;
    }

    createOrder.mutate(
      {
        type: orderType,
        tableId: orderType === "DINE_IN" ? tableId : undefined,
        items,
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

  const viewExistingOrder = () => {
    if (existingOrder) setActiveOrder(existingOrder);
  };

  const resetForNewOrder = () => {
    setActiveOrder(null);
    setLines([]);
    setTableId("");
  };

  const handleTablePick = (table: RestaurantTable) => setTableId(table.id);

  // Click-to-order: for a fresh dine-in ticket, land on a visual table grid
  // first — the rest of the flow (menu, cart, bill-or-add-more) is
  // unchanged once a table's picked. Takeaway orders and orders already
  // mid-flow (tableId set, or viewing/paying an order) skip straight past
  // it, same as arriving here from the Tables page's own "New order" link
  // (?tableId=... pre-fills this and never shows the picker).
  const showTablePicker = orderType === "DINE_IN" && !tableId && !activeOrder;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <KitchenProgressWidget branchId={branchId} />

      {showTablePicker ? (
        <Card className="flex-1 overflow-hidden p-5">
          <PosTablePicker floors={floors ?? []} onSelect={handleTablePick} />
        </Card>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-[1fr_360px]">
          <Card className="overflow-hidden p-5">
            <ProductGrid branchId={branchId} onSelect={handleSelect} />
          </Card>

          <Card className="overflow-hidden p-5">
            {activeOrder ? (
              <CheckoutPanel
                order={activeOrder}
                branchId={branchId}
                initialCustomer={existingOrder?.customer}
                onDone={resetForNewOrder}
              />
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
                isSubmitting={createOrder.isPending || addOrderItems.isPending}
                existingOrderNumber={existingOrder?.orderNumber}
                onViewExistingOrder={existingOrder ? viewExistingOrder : undefined}
              />
            )}
          </Card>
        </div>
      )}

      <ModifierPickerDialog
        item={pickerItem}
        open={!!pickerItem}
        onOpenChange={(open) => !open && setPickerItem(null)}
        onConfirm={handleModifierConfirm}
      />
    </div>
  );
}
