import type { Metadata } from "next";
import Link from "next/link";
import { DocPage, DocSection } from "@/components/marketing/doc-page";
import { downloadHref } from "@/lib/downloads";

export const metadata: Metadata = {
  title: "Documentation — Nodedr OrderRestro",
  description: "API & MCP, accessibility, and India compliance docs for a self-hosted OrderRestro instance.",
};

const docs = [
  {
    href: "/docs/api",
    title: "API & MCP",
    description: "Connect an AI client via MCP, or use OrderRestro as a backend for your own website.",
  },
  {
    href: "/docs/accessibility",
    title: "Accessibility",
    description: "How OrderRestro is built to work with keyboards, screen readers, and reduced motion.",
  },
  {
    href: "/docs/compliance-india",
    title: "India compliance",
    description: "GST, receipts, and data-residency notes for running OrderRestro in India.",
  },
];

export default function DocsIndexPage() {
  return (
    <DocPage title="Documentation" updated="30 September 2026">
      <DocSection heading="Guides">
        <div className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60">
          {docs.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="flex flex-col gap-1 p-4 transition-colors hover:bg-secondary"
            >
              <span className="text-sm font-medium text-foreground">{doc.title}</span>
              <span className="text-sm text-muted-foreground">{doc.description}</span>
            </Link>
          ))}
        </div>
      </DocSection>

      <DocSection heading="Full setup & architecture docs">
        <p>
          Installation, environment variables, and the full architecture reference live in the{" "}
          <a
            href={downloadHref("github")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
          >
            GitHub repository
          </a>
          &rsquo;s README and docs folder.
        </p>
      </DocSection>
    </DocPage>
  );
}
