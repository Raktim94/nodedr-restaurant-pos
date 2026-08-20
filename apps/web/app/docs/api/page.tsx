import type { Metadata } from "next";
import { DocList, DocPage, DocSection } from "@/components/marketing/doc-page";

export const metadata: Metadata = {
  title: "API & MCP — Nodedr OrderRestro",
  description:
    "Connect an AI client via MCP, or use OrderRestro as a backend for your own website: browse the menu, place orders, and book tables through a scoped API key.",
};

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card p-4 text-[13px] leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

export default function ApiDocsPage() {
  return (
    <DocPage title="API &amp; MCP" updated="20 August 2026">
      <DocSection heading="Two ways to connect">
        <p>
          OrderRestro exposes two separate integrations, each with its own kind of API key, both managed from{" "}
          <strong className="text-foreground">Settings &gt; API Keys</strong> once you&rsquo;re signed in:
        </p>
        <DocList
          items={[
            <>
              <strong className="text-foreground">MCP server</strong> — connect an AI client (Claude Desktop, or any{" "}
              <a href="https://modelcontextprotocol.io" className="text-primary underline underline-offset-4">
                Model Context Protocol
              </a>{" "}
              client) using a personal access token. It acts as you, with your exact staff permissions.
            </>,
            <>
              <strong className="text-foreground">Integration API</strong> — a plain REST API for your own
              website&rsquo;s backend to use OrderRestro directly: browse the menu, place orders, and book tables for
              a location you choose. Not tied to any staff account — you grant it only the permissions it needs.
            </>,
          ]}
        />
      </DocSection>

      <DocSection heading="MCP server">
        <p>
          Point your MCP client at <code className="rounded bg-card px-1.5 py-0.5 text-foreground">https://your-domain/api/v1/mcp</code>{" "}
          with header <code className="rounded bg-card px-1.5 py-0.5 text-foreground">Authorization: Bearer &lt;key&gt;</code>. It&rsquo;s
          a deliberately curated set of tools — nothing destructive (no deletes, no user/role management, no backup
          restore) is reachable through MCP, and every tool re-checks the same permission the equivalent page in the
          app would require.
        </p>
        <DocList
          items={[
            "list_locations, dashboard_summary — read-only, any staff member",
            "list_open_orders, get_order, create_order — requires the Create Orders permission",
            "list_reservations, create_reservation, update_reservation_status — requires the Manage Reservations permission",
          ]}
        />
      </DocSection>

      <DocSection heading="Integration API">
        <p>
          Base URL: <code className="rounded bg-card px-1.5 py-0.5 text-foreground">https://your-domain/api/v1/integrations</code>. This
          is meant for server-to-server calls — your website&rsquo;s own backend calling OrderRestro, not embedding
          the key in browser JavaScript.
        </p>
        <Code>{`GET  /locations                              (scope: locations:read)
GET  /locations/:branchId/menu               (scope: menu:read)
POST /locations/:branchId/orders             (scope: orders:write)
GET  /locations/:branchId/orders/:id         (scope: orders:read)
POST /locations/:branchId/reservations       (scope: reservations:write)
GET  /locations/:branchId/reservations/:id   (scope: reservations:read)`}</Code>
        <p>Placing an order:</p>
        <Code>{`curl -X POST https://your-domain/api/v1/integrations/locations/<branchId>/orders \\
  -H "Authorization: Bearer ordr_ext_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "TAKEAWAY",
    "customerName": "Jane Doe",
    "customerPhone": "+15550100",
    "items": [{ "menuItemId": "...", "quantity": 2 }]
  }'`}</Code>
        <p>Booking a table:</p>
        <Code>{`curl -X POST https://your-domain/api/v1/integrations/locations/<branchId>/reservations \\
  -H "Authorization: Bearer ordr_ext_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerName": "Jane Doe",
    "phone": "+15550100",
    "guestCount": 4,
    "reservedAt": "2026-08-25T19:00:00Z"
  }'`}</Code>
      </DocSection>

      <DocSection heading="Security model">
        <DocList
          items={[
            "Integration keys carry no staff identity — a leaked key can only do exactly what its scopes and location allow.",
            "Personal (MCP) keys inherit your exact role permissions — revoke one immediately if you suspect it leaked, same as a password.",
            "Every key is shown in full exactly once, at creation. Only a masked last four characters are ever stored or displayed again.",
            "Revoking a key takes effect immediately.",
          ]}
        />
      </DocSection>

      <DocSection heading="Full reference">
        <p>
          For the complete endpoint reference, error codes, and rate limits, see{" "}
          <a
            href="https://github.com/Raktim94/nodedr-restaurant-pos/blob/main/docs/integrations-api.md"
            className="text-primary underline underline-offset-4"
          >
            docs/integrations-api.md
          </a>{" "}
          in the repository.
        </p>
      </DocSection>
    </DocPage>
  );
}
