"use client";

import { useState } from "react";
import { TableTile } from "@/components/tables/table-tile";
import { WaitlistPanel } from "@/components/tables/waitlist-panel";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBranch } from "@/hooks/use-branch";
import { useFloors } from "@/hooks/use-tables";

export default function TablesPage() {
  const { branchId } = useBranch();
  const { data: floors, isLoading } = useFloors(branchId);
  const [activeFloorId, setActiveFloorId] = useState<string | undefined>(undefined);

  const activeFloor = floors?.find((f) => f.id === (activeFloorId ?? floors[0]?.id));
  const allTables = floors?.flatMap((f) => f.tables) ?? [];
  const availableTables = allTables.filter((t) => t.status === "AVAILABLE");

  const canvasWidth = activeFloor
    ? Math.max(600, ...activeFloor.tables.map((t) => t.posX + t.width + 40))
    : 600;
  const canvasHeight = activeFloor
    ? Math.max(320, ...activeFloor.tables.map((t) => t.posY + t.height + 40))
    : 320;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Tables</h1>
        <p className="text-sm text-muted-foreground">Live floor status — tap a table to update it</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : floors && floors.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-4">
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

            <Card className="overflow-auto p-6">
              <div
                className="relative"
                style={{ width: canvasWidth, height: canvasHeight, minWidth: "100%" }}
              >
                {activeFloor?.tables.map((table) => (
                  <TableTile
                    key={table.id}
                    table={table}
                    allTables={allTables}
                    branchId={branchId}
                    style={{
                      left: table.posX,
                      top: table.posY,
                      width: table.width,
                      height: table.height,
                    }}
                  />
                ))}
                {activeFloor?.tables.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No tables on this floor yet.
                  </p>
                )}
              </div>
            </Card>

            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <Legend color="bg-success" label="Available" />
              <Legend color="bg-primary" label="Occupied" />
              <Legend color="bg-warning" label="Reserved" />
              <Legend color="bg-muted-foreground" label="Cleaning / out of service" />
            </div>
          </div>

          <WaitlistPanel branchId={branchId} availableTables={availableTables} />
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-2 p-16 text-center">
          <p className="text-sm font-medium text-foreground">No floors yet</p>
          <p className="text-sm text-muted-foreground">
            Floors and tables are seeded from the backend for this demo branch.
          </p>
        </Card>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </div>
  );
}
