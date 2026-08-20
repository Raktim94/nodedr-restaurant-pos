"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useCurrentUser } from "@/hooks/use-auth";
import { BranchProvider, useBranch } from "@/hooks/use-branch";
import { useRealtime } from "@/hooks/use-realtime";

// Subscribes every route in this layout group to realtime push (order/KOT/
// table updates) instead of only the one page (KDS) that happened to call
// useRealtime itself — the Dashboard summary page had NO push subscription
// at all and relied solely on its own 15s/60s polling (see use-dashboard.ts),
// so a payment completed at one terminal took up to 15s to show up on a
// manager's dashboard tab elsewhere, or never did if that tab predates the
// poll window. Rendered as a child of BranchProvider (not the layout
// component itself) since useBranch() needs to run below the provider.
function RealtimeBridge() {
  const { branchId } = useBranch();
  useRealtime(branchId);
  return null;
}

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading, isError } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && isError) {
      router.replace("/login");
    }
  }, [isLoading, isError, router]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background" />;
  }

  if (isError || !data) {
    return null;
  }

  return (
    <BranchProvider>
      <RealtimeBridge />
      <AppShell user={data.user}>{children}</AppShell>
    </BranchProvider>
  );
}
