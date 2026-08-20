# OrderRestro integrations: MCP server and public API

OrderRestro exposes two separate ways to integrate with it programmatically,
each with its own credential type. Both are managed from **Settings > API
Keys** in the app.

| | **Personal API keys (MCP)** | **Integration API keys** |
|---|---|---|
| Who it's for | You (a staff member), connecting an AI client or script | An external website/system using OrderRestro as a backend |
| Identity | Acts as you, with your exact role permissions | No staff identity — carries its own explicit permission list |
| Created by | Any logged-in staff member, for themselves | Anyone with the `settings.manage` permission (owners/admins) |
| Scope | Everything you can already do in the app | Only what you tick when creating the key, optionally locked to one location |
| Used via | The MCP server (`/api/v1/mcp`) | The REST API (`/api/v1/integrations/*`) |

Both are Bearer tokens: `Authorization: Bearer <key>`. Neither uses cookies,
so both work from outside a browser.

---

## 1. MCP server (for AI clients)

Point an MCP client (Claude Desktop, or any [Model Context
Protocol](https://modelcontextprotocol.io) client) at:

```
https://<your-orderrestro-domain>/api/v1/mcp
```

with header `Authorization: Bearer <personal api key>`. Create a key from
**Settings > API Keys > Personal API keys & MCP > New key**.

The server is stateless HTTP (Streamable HTTP transport, no server-held
session) — every request is authenticated independently by the key.

### Available tools

MCP exposes a deliberately curated subset of what the app can do — nothing
destructive (no delete-order, no void/refund, no user/role management, no
backup restore) is reachable through MCP, regardless of what your account
can otherwise do. Every tool below also re-checks the exact permission the
equivalent page in the app would require, so an MCP client can never do more
than you personally could through the UI.

| Tool | Required permission | What it does |
|---|---|---|
| `list_locations` | — (any staff) | List your restaurant's active locations |
| `dashboard_summary` | — (any staff) | Today's sales/orders summary for one location |
| `list_open_orders` | `orders.create` | List currently open orders, optionally filtered to one table |
| `get_order` | `orders.create` | Full detail for one order (items, KOTs, payments) |
| `create_order` | `orders.create` | Create a new dine-in/takeaway/delivery order |
| `list_reservations` | `reservations.manage` | List reservations, optionally on one date |
| `create_reservation` | `reservations.manage` | Book a table |
| `update_reservation_status` | `reservations.manage` | Transition a reservation's status |

### Example: list tools

```bash
curl -X POST https://your-domain/api/v1/mcp \
  -H "Authorization: Bearer ordr_staff_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Example: create a reservation

```bash
curl -X POST https://your-domain/api/v1/mcp \
  -H "Authorization: Bearer ordr_staff_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {
      "name": "create_reservation",
      "arguments": {
        "branchId": "...",
        "customerName": "Jane Doe",
        "guestCount": 4,
        "reservedAt": "2026-08-25T19:00:00Z"
      }
    }
  }'
```

---

## 2. Integration API (for an external website's backend)

A REST API an external system calls as OrderRestro's backend — browse a
location's menu, place an order, book a table, check status. Create a key
from **Settings > API Keys > Integration API keys > New key**: pick a name,
optionally scope it to one location ("selected location"), and tick the
exact permissions ("scopes") it needs.

**This is meant for server-to-server calls** — your website's own backend
calling OrderRestro, not embedding the raw key in browser JavaScript. The
key is a reusable credential, not a per-resource token, so treat it like any
other API secret.

Base URL: `https://<your-orderrestro-domain>/api/v1/integrations`

Every request needs `Authorization: Bearer <integration api key>`. A
request to a scope the key wasn't granted returns `403`; a request for a
`branchId` outside the key's own location scope (or a different
restaurant entirely) returns `403`/`404`.

### `GET /locations`

Scope: `locations:read`. Lists active locations. If the key is scoped to
one location, only that location is returned.

```bash
curl -H "Authorization: Bearer ordr_ext_..." \
  https://your-domain/api/v1/integrations/locations
```

```json
[{ "id": "...", "name": "Main Branch", "address": "...", "phone": "..." }]
```

### `GET /locations/:branchId/menu`

Scope: `menu:read`. Returns categories and active items for that location.

```json
{
  "locationId": "...",
  "locationName": "Main Branch",
  "categories": [
    {
      "id": "...", "name": "Starters",
      "items": [
        { "id": "...", "name": "Spring Rolls", "price": "199", "isVeg": true, "spiceLevel": "NONE", "allergens": [] }
      ]
    }
  ]
}
```

### `POST /locations/:branchId/orders`

Scope: `orders:write`. Creates a takeaway/delivery order.

```bash
curl -X POST https://your-domain/api/v1/integrations/locations/<branchId>/orders \
  -H "Authorization: Bearer ordr_ext_..." \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TAKEAWAY",
    "customerName": "Jane Doe",
    "customerPhone": "+15550100",
    "items": [{ "menuItemId": "...", "quantity": 2 }]
  }'
```

`type` is `TAKEAWAY` (default) or `DELIVERY`. `items[].modifierIds` and
`items[].kitchenNote` are optional. Repeat orders from the same phone
number are attached to the same lightweight customer profile
automatically. Returns the full created order (same shape the POS uses),
including its generated KOT.

### `GET /locations/:branchId/orders/:orderId`

Scope: `orders:read`. Returns full order detail (items, KOT status,
payments) — poll this to track an order's progress.

### `POST /locations/:branchId/reservations`

Scope: `reservations:write`. Books a table.

```bash
curl -X POST https://your-domain/api/v1/integrations/locations/<branchId>/reservations \
  -H "Authorization: Bearer ordr_ext_..." \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Jane Doe",
    "phone": "+15550100",
    "guestCount": 4,
    "reservedAt": "2026-08-25T19:00:00Z",
    "durationMinutes": 90
  }'
```

### `GET /locations/:branchId/reservations/:reservationId`

Scope: `reservations:read`. Returns the reservation's current status
(`RESERVED`, `CONFIRMED`, `ARRIVED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

### Errors

Standard HTTP status codes: `401` missing/invalid/revoked key, `403`
missing scope or wrong location, `404` location/order/reservation not
found, `400` invalid request body. Error bodies are
`{ "message": "...", "error": "...", "statusCode": ... }`.

### Rate limits

Order and reservation creation are throttled to 60 requests/minute per
caller, on top of the app-wide 300 requests/minute default.

---

## Security model

- Integration keys carry **no staff identity** — a leaked key can only do
  exactly what its scopes and location allow, never anything a staff login
  could do beyond that.
- Personal (MCP) keys **inherit your exact role permissions** — revoke one
  immediately if you suspect it leaked, same as a password.
- Every key is shown in full exactly once, at creation. Only a masked last
  four characters are ever stored or displayed again.
- Revoking a key takes effect immediately — the next request with that key
  gets `401`.
