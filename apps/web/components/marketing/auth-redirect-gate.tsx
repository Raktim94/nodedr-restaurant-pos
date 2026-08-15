"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/use-auth";

// A returning, already-logged-in visitor hitting "/" should land on their
// dashboard, not the marketing page — this is the one client-side redirect
// this page needs; everything else renders immediately for a logged-out
// visitor (the common case for a marketing homepage).
export function AuthRedirectGate() {
  const { data, isSuccess } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (isSuccess && data?.user) {
      router.replace("/dashboard");
    }
  }, [isSuccess, data, router]);

  return null;
}
