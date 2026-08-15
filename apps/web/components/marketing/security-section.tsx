import { FileCheck2, Lock, ScanEye, ServerCog } from "lucide-react";
import Link from "next/link";
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/reveal";

const points = [
  {
    icon: Lock,
    title: "Hardened by default",
    description:
      "bcrypt password hashing, rate-limited login/PIN, httpOnly session cookies, and strict tenant isolation on every query.",
  },
  {
    icon: ServerCog,
    title: "Server-authoritative money",
    description:
      "Prices, tax, discounts, and totals are always recomputed server-side — checkout and refunds are race-condition safe under concurrent requests.",
  },
  {
    icon: ScanEye,
    title: "Your data stays on your server",
    description:
      "Self-hosted on your own LAN or VPS — no restaurant or customer data is ever sent to a third-party cloud you don't control.",
  },
  {
    icon: FileCheck2,
    title: "Documented compliance posture",
    description:
      "Written accessibility and India data-protection notes — not a marketing claim, an actual document you can read.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="border-y border-border/60 bg-muted/30 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Security isn&rsquo;t a checkbox here
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every module went through a real audit pass before this page did.
            Read the details, don&rsquo;t just take our word for it.
          </p>
        </Reveal>

        <RevealGroup className="mt-14 grid gap-5 sm:grid-cols-2">
          {points.map((p) => (
            <RevealItem
              key={p.title}
              className="flex gap-4 rounded-2xl border border-border/60 bg-card p-6"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <p.icon className="size-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {p.description}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal delay={0.1} className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/docs/accessibility"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Read the accessibility statement
          </Link>
          <span className="text-sm text-muted-foreground">·</span>
          <Link
            href="/docs/compliance-india"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Read the India compliance notes
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
