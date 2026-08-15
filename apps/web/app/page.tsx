import { MotionConfig } from "motion/react";
import { AuthRedirectGate } from "@/components/marketing/auth-redirect-gate";
import { Features } from "@/components/marketing/features";
import { Hero } from "@/components/marketing/hero";
import { InstallSection } from "@/components/marketing/install-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { SecuritySection } from "@/components/marketing/security-section";

export default function MarketingHomePage() {
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
