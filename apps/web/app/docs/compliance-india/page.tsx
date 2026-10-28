import type { Metadata } from "next";
import { DocList, DocPage, DocSection } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "India compliance notes — Restrovia",
  description: "How Restrovia's architecture relates to Indian data-protection, IT, and consumer-protection law.",
};

export default function ComplianceIndiaPage() {
  return (
    <DocPage title="India compliance notes" updated="28 October 2026">
      <DocSection heading="This is not legal advice">
        <p>
          This page explains how Restrovia is built with reference to
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
          Restrovia is a hosted service: we run the servers and database on
          your behalf. The restaurant that signs up is the{" "}
          <strong className="text-foreground">Data Fiduciary</strong> under
          the Digital Personal Data Protection Act, 2023 (DPDP Act) for the
          customer and staff personal data it collects through the app, and
          Restrovia processes that data only to provide the service, as a
          data processor acting on the restaurant&rsquo;s instructions.
        </p>
        <p>
          Where the data is hosted, which sub-processors are used and how
          cross-border transfers are handled are set out in the Restrovia
          service agreement and privacy policy. Please read those before
          you start collecting customer data.
        </p>
      </DocSection>

      <DocSection heading="DPDP Act, 2023 — what the software supports">
        <p>
          The DPDP Act gives individuals (&ldquo;Data Principals&rdquo;)
          rights to access, correct, and erase their personal data, and
          requires Data Fiduciaries to collect only what&rsquo;s needed for
          a stated purpose, retain it no longer than necessary, and provide
          a grievance-redressal channel. Restrovia&rsquo;s data model and
          controls that a deploying restaurant can use to meet these:
        </p>
        <DocList
          items={[
            "Customer records (name, phone, order/visit history, loyalty points) are editable and deletable by any staff member with the customers.manage permission — supporting correction and erasure requests.",
            "Only the data fields actually used by POS/CRM/loyalty features are collected — no speculative profile fields.",
            "Role-based access control restricts who on staff can view customer contact details and order history, supporting a purpose-limitation and least-privilege posture.",
            "Every table/order/session is scoped to the restaurant that created it — verified during a security audit that one restaurant's staff cannot query another restaurant's customer data, which is what keeps each restaurant&rsquo;s data separate on Restrovia&rsquo;s shared infrastructure.",
          ]}
        />
        <p>
          What Restrovia does <em>not</em> provide out of the box: a
          built-in consent-capture flow, an automated data-retention/deletion
          schedule, or a grievance-officer contact form for your own customers — these are
          organizational obligations the restaurant (as Data Fiduciary) needs to put in place itself (e.g. a printed/posted
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
          Restrovia is served over HTTPS. Devices on your own premises, such
          as printers and kitchen displays, connect through your
          restaurant&rsquo;s network, so keeping that network secured is your
          responsibility.
        </p>
      </DocSection>

      <DocSection heading="GST invoicing (CGST Rules, Rule 46)">
        <p>
          Receipts generated by Restrovia display the branch&rsquo;s
          GSTIN (when configured in Settings), an itemized CGST/SGST
          breakup, and a per-order invoice/order number. Whether your
          specific invoice numbering and layout fully satisfies Rule 46 of
          the CGST Rules, 2017 for your registration and turnover bracket
          (e.g. sequential numbering per financial year, HSN/SAC code
          requirements at your turnover level) is something to confirm with
          your chartered accountant before relying on Restrovia receipts
          as your sole tax-invoice record — this software generates a
          receipt in the right shape, it does not itself certify GST
          compliance for your specific registration.
        </p>
      </DocSection>

      <DocSection heading="Questions">
        <p>
          For questions about Restrovia&rsquo;s architecture or security
          posture, please{" "}
          <a
            href="https://restrovia.shop/contact"
            className="text-primary underline underline-offset-4"
          >
            contact us
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
