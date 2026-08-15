"use client";

import { Check, Copy, Github, HardDrive, Terminal } from "lucide-react";
import { useState } from "react";
import { AnimatedCounter } from "@/components/marketing/animated-counter";
import { Reveal, RevealGroup, RevealItem } from "@/components/marketing/reveal";
import { downloadHref, totalDownloads } from "@/lib/downloads";
import { useDownloadStats } from "@/hooks/use-download-stats";

const INSTALL_COMMAND =
  "git clone https://github.com/Raktim94/nodedr-restaurant-pos.git && cd nodedr-restaurant-pos && ./install.sh";

const channels = [
  {
    channel: "install-script" as const,
    icon: Terminal,
    title: "One-click install",
    description: "Clone the repo and run install.sh — generates secrets, builds, and seeds nothing but a real signup.",
  },
  {
    channel: "docker" as const,
    icon: HardDrive,
    title: "Docker Compose",
    description: "Postgres, API, and web app — three services, one docker compose up.",
  },
  {
    channel: "casaos" as const,
    icon: HardDrive,
    title: "CasaOS / ZimaOS",
    description: "Install from the official CasaOS App Store on your home server or NAS.",
  },
  {
    channel: "github" as const,
    icon: Github,
    title: "View source",
    description: "AGPL-3.0 licensed. Read the code, fork it, self-host it — nothing hidden.",
  },
];

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="group flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-left font-mono text-[13px] text-foreground/90 transition-colors hover:border-primary/40"
    >
      <span className="truncate">{INSTALL_COMMAND}</span>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

export function InstallSection() {
  const { data: stats } = useDownloadStats();
  const total = totalDownloads(stats);

  return (
    <section id="get-started" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Running in minutes, not a sales call
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Pick a path. Every route lands on the exact same self-hosted stack.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-8 flex justify-center">
        <CopyCommand />
      </Reveal>

      <RevealGroup className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {channels.map((c) => (
          <RevealItem key={c.channel}>
            <a
              href={downloadHref(c.channel)}
              className="group flex h-full flex-col rounded-2xl border border-border/60 bg-card p-6 transition-colors hover:border-primary/40"
            >
              <div className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <c.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-foreground">{c.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                {c.description}
              </p>
              <span className="mt-4 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Continue &rarr;
              </span>
            </a>
          </RevealItem>
        ))}
      </RevealGroup>

      <Reveal delay={0.15} className="mt-14 flex flex-col items-center gap-1 text-center">
        <p className="text-4xl font-semibold tabular-nums text-foreground sm:text-5xl">
          <AnimatedCounter value={total} />
        </p>
        <p className="text-sm text-muted-foreground">
          real link click-throughs tracked since launch &mdash; no pre-seeded number, see{" "}
          <a
            href="/api/v1/downloads/stats"
            className="underline underline-offset-4 hover:text-foreground"
          >
            the live counter API
          </a>
          .
        </p>
      </Reveal>
    </section>
  );
}
