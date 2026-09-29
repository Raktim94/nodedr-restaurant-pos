"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Public, unauthenticated — whether any restaurant has been registered on
// this self-hosted instance yet. Drives whether "/" shows the full
// marketing pitch (unclaimed install) or just Sign in + View documentation
// (someone already completed setup — see MarketingHomePage).
export function useSetupStatus() {
  return useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: () => api.get<{ isSetup: boolean }>("/auth/setup-status"),
    staleTime: 60_000,
  });
}
