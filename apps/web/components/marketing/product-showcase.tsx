"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/marketing/reveal";

const views = [
  { id: "dashboard", label: "Dashboard", src: "/screenshots/dashboard-light.png" },
  { id: "pos", label: "POS", src: "/screenshots/pos-light.png" },
  { id: "kds", label: "Kitchen display", src: "/screenshots/kds-light.png" },
  { id: "tables", label: "Tables", src: "/screenshots/tables-light.png" },
] as const;

// Real product screenshots (docs/screenshots/*.png, the same images the
// repo README uses) — not mockups. A crossfade, not a hard cut, when
// switching tabs.
export function ProductShowcase() {
  const [active, setActive] = useState<(typeof views)[number]["id"]>("dashboard");
  const current = views.find((v) => v.id === active)!;

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          See it in action
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          The actual app — no staged demo data, no Photoshop.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-8 flex justify-center">
        <div
          role="tablist"
          aria-label="Product views"
          className="inline-flex gap-1 rounded-xl border border-border/60 bg-muted/40 p-1"
        >
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active === v.id}
              onClick={() => setActive(v.id)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                active === v.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.16} className="relative mt-8">
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[0_20px_70px_-20px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-destructive/50" />
            <span className="size-2.5 rounded-full bg-warning/50" />
            <span className="size-2.5 rounded-full bg-success/50" />
          </div>
          <div className="relative aspect-[1440/900] w-full bg-muted/20">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                <Image
                  src={current.src}
                  alt={`${current.label} screen`}
                  fill
                  sizes="(min-width: 1024px) 1024px, 100vw"
                  className="object-cover object-top"
                  priority={current.id === "dashboard"}
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
