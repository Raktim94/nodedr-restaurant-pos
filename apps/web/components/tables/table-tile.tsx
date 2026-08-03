"use client";

import type { TableStatusDto } from "@nodedr-restaurant/types";
import { Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUpdateTableStatus, type RestaurantTable } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<TableStatusDto, string> = {
  AVAILABLE: "bg-success/10 border-success/30 text-success",
  OCCUPIED: "bg-primary/10 border-primary/30 text-primary",
  RESERVED: "bg-warning/10 border-warning/30 text-warning",
  CLEANING: "bg-muted border-border text-muted-foreground",
  OUT_OF_SERVICE: "bg-muted border-border text-muted-foreground opacity-60",
};

const STATUS_LABEL: Record<TableStatusDto, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  RESERVED: "Reserved",
  CLEANING: "Cleaning",
  OUT_OF_SERVICE: "Out of service",
};

export function TableTile({
  table,
  branchId,
  style,
}: {
  table: RestaurantTable;
  branchId: string | null;
  style?: React.CSSProperties;
}) {
  const updateStatus = useUpdateTableStatus(branchId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={style}
        className={cn(
          "absolute flex flex-col items-center justify-center gap-1 rounded-2xl border-2 text-xs font-medium shadow-sm transition-transform hover:scale-[1.03]",
          STATUS_STYLES[table.status],
        )}
      >
        <span className="text-sm font-semibold">{table.name ?? `T${table.number}`}</span>
        <span className="flex items-center gap-1 text-[11px] opacity-80">
          <Users className="h-3 w-3" />
          {table.capacity}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {STATUS_LABEL[table.status]} · {table.capacity} guests
        </div>
        {(Object.keys(STATUS_LABEL) as TableStatusDto[]).map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={status === table.status}
            onClick={() => updateStatus.mutate({ id: table.id, status })}
          >
            {STATUS_LABEL[status]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
