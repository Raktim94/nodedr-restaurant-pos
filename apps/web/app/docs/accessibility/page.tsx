import type { Metadata } from "next";
import { DocList, DocPage, DocSection } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "Accessibility statement — Nodedr OrderRestro",
  description: "OrderRestro's accessibility conformance target, testing methodology, and known gaps.",
};

export default function AccessibilityPage() {
  return (
    <DocPage title="Accessibility statement" updated="15 August 2026">
      <DocSection heading="Our target">
        <p>
          Nodedr OrderRestro targets{" "}
          <strong className="text-foreground">WCAG 2.1 Level AA</strong> across
          this marketing site and the product application (POS, dashboard,
          kitchen display, settings). This is the standard referenced by
          India&rsquo;s Rights of Persons with Disabilities Act, 2016 and its
          associated accessibility rules, and is the de facto baseline for
          any software sold or deployed in India today.
        </p>
        <p>
          This statement is a good-faith, current snapshot — not a
          certification. We have not engaged a third-party auditor or
          obtained formal WCAG-AA certification for this product.
        </p>
      </DocSection>

      <DocSection heading="What we actually do">
        <DocList
          items={[
            <>
              Semantic HTML and landmark regions (
              <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">
                header
              </code>
              /
              <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">
                main
              </code>
              /
              <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">
                nav
              </code>
              ) throughout, not div soup with click handlers standing in for
              real interactive elements.
            </>,
            "Keyboard navigation for every interactive control, including the mobile navigation menu, tab panels, and form flows — nothing on this site is mouse-only.",
            "Visible focus indicators (focus-visible rings) on all interactive elements, not suppressed via outline:none.",
            "Color contrast checked against the design system's own light and dark token pairs (see DESIGN_SYSTEM.md in the repository) for text-on-background combinations used in primary UI.",
            <>
              All animation on this site respects{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[13px] text-foreground">
                prefers-reduced-motion
              </code>{" "}
              — set it in your OS and page transitions, scroll reveals, and
              counters resolve instantly instead of animating.
            </>,
            "Alt text on informative images; decorative graphics are marked aria-hidden so screen readers don't announce them.",
            "Forms (login, signup, checkout) associate every input with a visible label and surface validation errors as text, not color alone.",
          ]}
        />
      </DocSection>

      <DocSection heading="How we test">
        <p>
          We run automated accessibility audits (axe-core based tooling)
          against live pages during development, and review keyboard-only
          and screen-reader navigation manually for new or substantially
          changed screens before shipping them.
        </p>
        <p>
          We have not yet performed a full manual audit with users who rely
          on assistive technology day-to-day. That is the single biggest gap
          between an automated-clean audit and genuine accessibility, and we
          are not going to claim otherwise.
        </p>
      </DocSection>

      <DocSection heading="Known gaps">
        <DocList
          items={[
            "No dedicated screen-reader testing pass on the Kitchen Display / real-time ticket views yet — the live-update pattern (sockets pushing new tickets) needs an aria-live region audit.",
            "No published VPAT (Voluntary Product Accessibility Template) yet.",
            "Third-party components (browser print dialogs, OS file pickers) inherit their accessibility from the host OS/browser, outside our control.",
          ]}
        />
      </DocSection>

      <DocSection heading="Reporting a problem">
        <p>
          If you encounter an accessibility barrier anywhere in this product,
          please open an issue on{" "}
          <a
            href="https://github.com/Raktim94/nodedr-restaurant-pos/issues"
            className="text-primary underline underline-offset-4"
          >
            GitHub
          </a>{" "}
          with as much detail as you can (page, assistive technology used,
          what you expected vs. what happened). This is an open-source
          project — accessibility fixes are treated as real bugs, not
          feature requests.
        </p>
      </DocSection>
    </DocPage>
  );
}
