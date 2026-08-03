"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useCurrentUser } from "@/hooks/use-auth";
import { BranchProvider } from "@/hooks/use-branch";

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
      <AppShell user={data.user}>{children}</AppShell>
    </BranchProvider>
  );
}
