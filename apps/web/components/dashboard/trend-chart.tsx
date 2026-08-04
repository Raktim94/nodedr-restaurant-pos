"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatDayLabel(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function TrendChart({
  title,
  icon: Icon,
  data,
  valueKey,
  color,
  valueFormatter,
  isLoading,
  emptyMessage,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  data: Record<string, string | number>[];
  valueKey: string;
  color: string;
  valueFormatter: (value: number) => string;
  isLoading: boolean;
  emptyMessage: string;
}) {
  const hasData = data.some((d) => Number(d[valueKey]) > 0);

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
        <Icon className="h-[18px] w-[18px] text-muted-foreground" />
        {title}
      </h2>

      {isLoading ? (
        <Skeleton className="h-56 rounded-xl" />
      ) : !hasData ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayLabel}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v: number) => valueFormatter(v)}
              />
              <Tooltip
                formatter={(value: number) => valueFormatter(value)}
                labelFormatter={(label: string) => formatDayLabel(label)}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey={valueKey}
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
