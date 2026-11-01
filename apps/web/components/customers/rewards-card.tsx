"use client";

import { Gift } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerRewards } from "@/hooks/use-customers";
import { formatCurrency } from "@/lib/format";

const REASON: Record<string, string> = {
  REFERRAL_REFERRER: "Friend's first order",
  REFERRAL_REFERRED: "Welcome reward",
  EARN: "Earned on a bill",
  REDEEM: "Redeemed on a bill",
};

export function RewardsCard({ branchId, customerId }: { branchId: string | null; customerId: string }) {
  const { data, isLoading, isError } = useCustomerRewards(branchId, customerId);
  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (isError || !data) return null;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-[18px] font-medium text-foreground">Points and rewards</h2>
      </div>
      <p className="text-sm text-foreground">
        <span className="text-2xl font-semibold tabular-nums">{data.points}</span> points
        <span className="text-muted-foreground"> · worth {formatCurrency(data.balanceValue)}</span>
      </p>
      {data.rewards.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-xs">
          {data.rewards.map((r) => (
            <li key={r.points} className="rounded-full border border-border px-3 py-1">
              {r.points} pts = {formatCurrency(r.discount)} off
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No rewards available yet.</p>
      )}
      {data.referralEnabled && data.code && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Referral code</dt>
          <dd className="font-mono text-foreground">{data.code}</dd>
          <dt className="text-muted-foreground">Friends invited / ordered</dt>
          <dd className="text-foreground">{data.invited} / {data.rewarded}</dd>
          <dt className="text-muted-foreground">Points from referrals</dt>
          <dd className="text-foreground">{data.pointsFromReferrals}</dd>
          {data.referredBy && (
            <>
              <dt className="text-muted-foreground">Referred by a friend</dt>
              <dd className="text-foreground">{data.referredBy === "REWARDED" ? "Reward paid" : "Waiting for first paid order"}</dd>
            </>
          )}
        </dl>
      )}
      {data.history.length > 0 && (
        <ul className="flex max-h-40 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border text-xs">
          {data.history.map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-2 p-2">
              <span className="text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{REASON[h.reason] ?? h.reason}</span>
              <span className={h.delta > 0 ? "text-success" : "text-destructive"}>{h.delta > 0 ? "+" : ""}{h.delta}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
