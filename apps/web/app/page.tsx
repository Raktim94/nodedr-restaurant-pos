"use client";

import { MotionConfig } from "motion/react";
import { AuthRedirectGate } from "@/components/marketing/auth-redirect-gate";
import { ClaimedLanding } from "@/components/marketing/claimed-landing";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { InstallSection } from "@/components/marketing/install-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { SecuritySection } from "@/components/marketing/security-section";
import { useSetupStatus } from "@/hooks/use-setup-status";

export default function MarketingHomePage() {
  const { data, isLoading } = useSetupStatus();

  // Until we know: render nothing rather than flash the full sales pitch
  // (or the minimal claimed view) and then swap it a moment later.
  if (isLoading) {
    return null;
  }

  // This instance already has a restaurant registered — the public root is
  // now a live business's front door, not an unclaimed install's sales
  // page. Show only what a returning visitor actually needs.
  if (data?.isSetup) {
    return (
      <div className="flex min-h-full flex-col">
        <AuthRedirectGate />
        <ClaimedLanding />
      </div>
    );
  }

  return (
    // reducedMotion="user" makes every Motion animation on this page defer
    // to the OS prefers-reduced-motion setting automatically (transforms
    // swap for instant/opacity-only changes) instead of threading
    // useReducedMotion() through every component individually.
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-full flex-col">
        <AuthRedirectGate />
        <MarketingNav />
        <main id="main-content">
          <Hero />
          <ProductShowcase />
          <Features />
          <SecuritySection />
          <InstallSection />
        </main>
        <MarketingFooter />
      </div>
    </MotionConfig>
  );
}
