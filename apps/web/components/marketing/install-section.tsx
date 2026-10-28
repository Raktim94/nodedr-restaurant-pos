import Link from "next/link";
import { Reveal } from "@/components/marketing/reveal";

export function InstallSection() {
  return (
    <section id="get-started" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Start running your restaurant on Restrovia
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Create your account and set up your menu, tables and staff in minutes. Nothing to install or host yourself.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/signup"
          className="inline-flex h-11 items-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Create your account
        </Link>
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-xl border border-border/60 bg-background px-6 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
        >
          Sign in
        </Link>
      </Reveal>
    </section>
  );
}
