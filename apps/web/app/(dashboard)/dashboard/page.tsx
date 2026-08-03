"use client";

import { ChefHat, ClipboardList, Flame, ReceiptText, Timer, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useDashboardSummary } from "@/hooks/use-dashboard";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  accent?: "success" | "warning";
}) {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl",
            accent === "success" && "bg-success/10 text-success",
            accent === "warning" && "bg-warning/10 text-warning",
            !accent && "bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </span>
    </Card>
  );
}

function TableStatusRow({ label, count, dotClass }: { label: string; count: number; dotClass: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dotClass)} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="font-medium tabular-nums text-foreground">{count}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { branchId } = useBranch();
  const { data, isLoading } = useDashboardSummary(branchId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Real-time overview of today&apos;s service</p>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(data.todayRevenue)}
            icon={Wallet}
            accent="success"
          />
          <StatCard label="Today's Orders" value={String(data.todayOrders)} icon={ReceiptText} />
          <StatCard
            label="Occupied Tables"
            value={String(data.tables.occupied)}
            icon={ClipboardList}
          />
          <StatCard
            label="Kitchen Queue"
            value={String(
              data.kitchenQueue.new + data.kitchenQueue.accepted + data.kitchenQueue.preparing,
            )}
            icon={Flame}
            accent="warning"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-1 p-6 lg:col-span-1">
          <h2 className="mb-3 text-[18px] font-medium text-foreground">Tables</h2>
          {data && (
            <>
              <TableStatusRow label="Available" count={data.tables.available} dotClass="bg-success" />
              <TableStatusRow label="Occupied" count={data.tables.occupied} dotClass="bg-primary" />
              <TableStatusRow label="Reserved" count={data.tables.reserved} dotClass="bg-warning" />
              <TableStatusRow label="Cleaning" count={data.tables.cleaning} dotClass="bg-muted-foreground" />
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-1 p-6 lg:col-span-1">
          <h2 className="mb-3 flex items-center gap-2 text-[18px] font-medium text-foreground">
            <ChefHat className="h-[18px] w-[18px] text-muted-foreground" />
            Kitchen queue
          </h2>
          {data && (
            <>
              <TableStatusRow label="New" count={data.kitchenQueue.new} dotClass="bg-primary" />
              <TableStatusRow label="Accepted" count={data.kitchenQueue.accepted} dotClass="bg-warning" />
              <TableStatusRow label="Preparing" count={data.kitchenQueue.preparing} dotClass="bg-warning" />
              <TableStatusRow label="Ready" count={data.kitchenQueue.ready} dotClass="bg-success" />
            </>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-6 lg:col-span-1">
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <Timer className="h-[18px] w-[18px] text-muted-foreground" />
            Recent transactions
          </h2>
          <div className="flex flex-col divide-y divide-border">
            {data?.recentOrders.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">No sales yet today.</p>
            )}
            {data?.recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between py-2.5 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">#{order.orderNumber}</span>
                  <Badge variant="secondary" className="mt-0.5 w-fit text-[11px] font-normal">
                    {order.type.replace("_", " ")}
                  </Badge>
                </div>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCurrency(order.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
