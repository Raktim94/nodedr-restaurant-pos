import type { Metadata } from "next";
import { DocList, DocPage, DocSection } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "India compliance notes — Nodedr OrderRestro",
  description: "How OrderRestro's architecture relates to Indian data-protection, IT, and consumer-protection law.",
};

export default function ComplianceIndiaPage() {
  return (
    <DocPage title="India compliance notes" updated="15 August 2026">
      <DocSection heading="This is not legal advice">
        <p>
          This page explains how OrderRestro is built with reference to
          Indian law, so a restaurant operator deploying it can have an
          informed conversation with their own advisor — it is not a legal
          opinion, a certification, or a substitute for review by a
          qualified lawyer or chartered accountant. Laws referenced here
          (the DPDP Act 2023, IT Rules, CGST Rules, and CCPA guidelines) are
          current as of this page&rsquo;s last-updated date and may have
          changed since.
        </p>
      </DocSection>

      <DocSection heading="Who is the &ldquo;data fiduciary&rdquo;?">
        <p>
          OrderRestro is self-hosted software, not a cloud service Nodedr
          Infotech operates on your behalf. When a restaurant deploys
          OrderRestro on its own server, <strong className="text-foreground">
          that restaurant is the Data Fiduciary</strong> under the Digital
          Personal Data Protection Act, 2023 (DPDP Act) for the customer and
          staff personal data it collects through the app — the same way a
          restaurant using a paper register or a locally-run spreadsheet
          would be. Nodedr Infotech does not receive, store, or process that
          data on its own infrastructure in a self-hosted deployment.
        </p>
        <p>This has a practical upside: because the entire stack (Postgres, API, and web app) runs on hardware the restaurant controls, data residency and cross-border transfer questions under the DPDP Act are largely avoided by construction — the data simply never leaves the deploying operator&rsquo;s own server unless they choose to move it.</p>
      </DocSection>

      <DocSection heading="DPDP Act, 2023 — what the software supports">
        <p>
          The DPDP Act gives individuals (&ldquo;Data Principals&rdquo;)
          rights to access, correct, and erase their personal data, and
          requires Data Fiduciaries to collect only what&rsquo;s needed for
          a stated purpose, retain it no longer than necessary, and provide
          a grievance-redressal channel. OrderRestro&rsquo;s data model and
          controls that a deploying restaurant can use to meet these:
        </p>
        <DocList
          items={[
            "Customer records (name, phone, order/visit history, loyalty points) are editable and deletable by any staff member with the customers.manage permission — supporting correction and erasure requests.",
            "Only the data fields actually used by POS/CRM/loyalty features are collected — no speculative profile fields.",
            "Role-based access control restricts who on staff can view customer contact details and order history, supporting a purpose-limitation and least-privilege posture.",
            "Every table/order/session is scoped to the restaurant that created it — verified during a security audit that one restaurant's staff cannot query another restaurant's customer data, relevant if you run OrderRestro for multiple outlets on shared infrastructure.",
          ]}
        />
        <p>
          What OrderRestro does <em>not</em> provide out of the box: a
          built-in consent-capture flow, an automated data-retention/deletion
          schedule, or a hosted grievance-officer contact form — these are
          organizational obligations the deploying restaurant (as Data
          Fiduciary) needs to put in place itself (e.g. a printed/posted
          privacy notice, a designated grievance contact, and a manual or
          scripted retention policy for old customer records).
        </p>
      </DocSection>

      <DocSection heading="IT Act, 2000 &amp; reasonable security practices">
        <p>
          The IT (Reasonable Security Practices and Procedures and Sensitive
          Personal Data or Information) Rules, 2011 expect a body corporate
          handling sensitive personal data (which includes financial
          information and, in a POS context, payment details) to implement
          documented, reasonable security controls. What&rsquo;s implemented
          here, verified in a security audit rather than just claimed:
        </p>
        <DocList
          items={[
            "Passwords hashed with bcrypt (cost factor 12), never stored or logged in plaintext.",
            "Session cookies are httpOnly and SameSite-restricted; JWT sessions verified against a live user/active-status check on every request, not just at login.",
            "Rate limiting on authentication endpoints to resist credential-stuffing/brute-force attempts.",
            "Strict tenant isolation and role-based authorization enforced server-side on every request — the frontend is never trusted as an authorization boundary.",
            "All money calculations (prices, tax, discounts, totals) are computed server-side, never trusted from client input, with race-condition-safe checkout and refund handling.",
            "Uploaded files are validated against their actual file-signature bytes, not just a client-declared filename or MIME type, and stored under randomized, non-executable filenames.",
            "No hardcoded secrets in source; the backend refuses to start with a placeholder or short JWT signing secret.",
          ]}
        />
        <p>
          Transport encryption (HTTPS/TLS) for any deployment reachable
          beyond a trusted LAN is the deploying operator&rsquo;s
          responsibility — typically via a reverse proxy (Caddy, nginx, or a
          tunnel provider) in front of the app. A LAN-only deployment behind
          a restaurant&rsquo;s own router is not directly exposed to the
          public internet by default.
        </p>
      </DocSection>

      <DocSection heading="GST invoicing (CGST Rules, Rule 46)">
        <p>
          Receipts generated by OrderRestro display the branch&rsquo;s
          GSTIN (when configured in Settings), an itemized CGST/SGST
          breakup, and a per-order invoice/order number. Whether your
          specific invoice numbering and layout fully satisfies Rule 46 of
          the CGST Rules, 2017 for your registration and turnover bracket
          (e.g. sequential numbering per financial year, HSN/SAC code
          requirements at your turnover level) is something to confirm with
          your chartered accountant before relying on OrderRestro receipts
          as your sole tax-invoice record — this software generates a
          receipt in the right shape, it does not itself certify GST
          compliance for your specific registration.
        </p>
      </DocSection>

      <DocSection heading="Honest UI, on purpose (CCPA dark-patterns guidelines, 2023)">
        <p>
          The Central Consumer Protection Authority&rsquo;s 2023 guidelines
          on misleading advertisements and dark patterns explicitly name
          fabricated urgency, fake activity counters, and false social
          proof as prohibited practices. This site&rsquo;s download counter
          is a real, server-side count of actual link click-throughs,
          starting from zero — never pre-seeded with an invented number. If
          you build on this codebase, we&rsquo;d ask you to keep that
          practice rather than quietly seed it later.
        </p>
      </DocSection>

      <DocSection heading="Questions">
        <p>
          For questions about this software&rsquo;s architecture or
          security posture, open an issue on{" "}
          <a
            href="https://github.com/Raktim94/nodedr-restaurant-pos/issues"
            className="text-primary underline underline-offset-4"
          >
            GitHub
          </a>
          . For questions about your own restaurant&rsquo;s legal
          obligations as a Data Fiduciary or GST-registered business, please
          consult a qualified lawyer or chartered accountant — this page
          cannot answer those for your specific situation.
        </p>
      </DocSection>
    </DocPage>
  );
}
