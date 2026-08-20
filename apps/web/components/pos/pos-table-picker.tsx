"use client";

import type { TableStatusDto } from "@nodedr-restaurant/types";
import { Users } from "lucide-react";
import { useState } from "react";
import { ElapsedTimer } from "@/components/tables/elapsed-timer";
import { TableShapeIcon } from "@/components/tables/table-shape-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Floor, RestaurantTable } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<TableStatusDto, string> = {
  AVAILABLE: "bg-success/10 border-success/30 text-success hover:bg-success/15",
  OCCUPIED: "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15",
  RESERVED: "bg-warning/10 border-warning/30 text-warning hover:bg-warning/15",
  CLEANING: "bg-muted border-border text-muted-foreground",
  OUT_OF_SERVICE: "bg-muted border-border text-muted-foreground opacity-50",
};

const STATUS_LABEL: Record<TableStatusDto, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied — tap to add items or bill",
  RESERVED: "Reserved",
  CLEANING: "Cleaning",
  OUT_OF_SERVICE: "Out of service",
};

// A click-to-order table grid, purpose-built for POS: pick a table, land
// straight in the menu. Deliberately a separate, simpler component from
// components/tables/table-tile.tsx (no status dropdown, QR, merge, or bill
// dialog here — that's the Tables page's job) so the Tables tab itself
// stays untouched.
export function PosTablePicker({
  floors,
  onSelect,
}: {
  floors: Floor[];
  onSelect: (table: RestaurantTable) => void;
}) {
  const [activeFloorId, setActiveFloorId] = useState<string | undefined>(undefined);
  const activeFloor = floors.find((f) => f.id === (activeFloorId ?? floors[0]?.id));

  if (floors.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No tables set up yet.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {floors.length > 1 && (
        <Tabs value={activeFloorId ?? floors[0].id} onValueChange={setActiveFloorId}>
          <TabsList>
            {floors.map((floor) => (
              <TabsTrigger key={floor.id} value={floor.id}>
                {floor.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <div className="grid flex-1 auto-rows-min grid-cols-3 items-start gap-3 overflow-y-auto pb-2 sm:grid-cols-4 lg:grid-cols-5">
        {activeFloor?.tables.map((table) => {
          const clickable = table.status !== "CLEANING" && table.status !== "OUT_OF_SERVICE";
          return (
            <button
              key={table.id}
              type="button"
              disabled={!clickable}
              title={STATUS_LABEL[table.status]}
              onClick={() => onSelect(table)}
              className={cn(
                "flex h-28 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-xs font-medium shadow-sm transition-transform",
                clickable && "cursor-pointer hover:scale-[1.03]",
                !clickable && "cursor-not-allowed",
                STATUS_STYLES[table.status],
              )}
            >
              <TableShapeIcon shape={table.shape} capacity={table.capacity} className="h-6 w-6" />
              <span className="text-sm font-semibold">{table.name ?? `T${table.number}`}</span>
              <span className="flex items-center gap-1 text-[11px] opacity-80">
                <Users className="h-3 w-3" />
                {table.capacity}
              </span>
              {(table.status === "OCCUPIED" || table.status === "RESERVED") && (
                <ElapsedTimer since={table.statusSince} className="flex items-center gap-1 text-[10px] opacity-70" />
              )}
            </button>
          );
        })}
        {activeFloor?.tables.length === 0 && (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
            No tables on this floor yet.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend color="bg-success" label="Available" />
        <Legend color="bg-primary" label="Occupied" />
        <Legend color="bg-warning" label="Reserved" />
        <Legend color="bg-muted-foreground" label="Cleaning / out of service" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
      {label}
    </div>
  );
}
