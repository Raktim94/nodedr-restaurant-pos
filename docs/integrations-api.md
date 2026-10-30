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

MCP has full CRUD parity with what your account can do via the UI for
orders, reservations, menu, tables/floors, and staff attendance — every tool re-checks the
exact permission the equivalent page in the app would require, so an MCP
client can never do more than you personally could through the UI. Still
deliberately excluded, regardless of role: checkout/payment processing
(needs a real payment terminal), user/role management, and backup restore
— each is a distinct, much higher-blast-radius action than the rest of
this list.

| Tool | Required permission | What it does |
|---|---|---|
| `list_locations` | — (any staff) | List your restaurant's active locations |
| `dashboard_summary` | — (any staff) | Today's sales/orders summary for one location |
| `list_open_orders` | `orders.create` | List currently open orders, optionally filtered to one table |
| `get_order` | `orders.create` | Full detail for one order (items, KOTs, payments) |
| `create_order` | `orders.create` | Create a new dine-in/takeaway/delivery order |
| `cancel_order` | `orders.cancel` | Cancel an OPEN order the kitchen hasn't started |
| `refund_order` | `refunds.process` | Refund some or all of a PAID order |
| `list_reservations` | `reservations.manage` | List reservations, optionally on one date |
| `create_reservation` | `reservations.manage` | Book a table |
| `update_reservation_status` | `reservations.manage` | Transition a reservation's status |
| `list_deliveries` / `list_delivery_zones` | `delivery.manage` | Active or finished deliveries; the location's delivery zones |
| `assign_driver` / `update_delivery_status` | `delivery.manage` | Assign a driver; move a delivery along (picked up, delivered, failed) |
| `list_shifts` / `list_leave_requests` / `decide_leave_request` / `staff_performance` | `staff.manage` | Schedules, leave (approve/reject), per-staff sales and hours |
| `profit_and_loss` / `gst_report` / `list_expenses` | `accounting.manage` | Net sales, expenses and payroll cost; tax by rate; recorded expenses |
| `run_report` | `reports.access` | Any catalog report (sales-daily, popular-items, food-cost, peak-hours, retention, …) as columns + rows |
| `list_coupons` / `list_promotions` | `marketing.manage` | Coupon codes with usage; happy-hour discounts |
| `list_equipment` | `operations.manage` | Equipment with next service date and overdue flags |
| `list_attendance` | `attendance.manage` | List staff clock-in/out records for a location, optionally one date or one staff member |
| `clock_in` / `clock_out` | — (any staff) | Clock the calling staff member in at a location / out of their open shift |
| `create_menu_category` / `update_menu_category` / `delete_menu_category` | `menu.manage` | Manage menu categories |
| `create_menu_item` / `update_menu_item` / `delete_menu_item` | `menu.manage` | Manage menu items (price, image, availability, etc.) |
| `create_floor` / `update_floor` | `tables.manage` | Manage floors/sections |
| `create_tables_bulk` / `update_table` / `update_table_status` / `delete_table` | `tables.manage` | Manage individual tables |

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
calling OrderRestro. Keep the key in the backend's environment (for Next.js:
a server-only variable *without* the `NEXT_PUBLIC_` prefix, used only in Route
Handlers / Server Actions). Never put it in browser JavaScript, a static
bundle or source control. The key is a reusable credential, not a per-resource
token, so treat it like any other API secret. Give it only the scopes it
needs: for a typical website `locations:read`, `menu:read`, `orders:write`,
`orders:read` and, only if the site must show or forward the customer's mobile
and address, `orders:read_customer`.

To expose the API on the internet, and a complete Next.js example, see
[website-integration.md](website-integration.md).

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

Scope: `menu:read`. Categories and active items that the owner has switched
on under "Show on website", with each item's modifier groups (the
`modifierIds` you may send when ordering) and its optional ordering window
(`availableFrom` / `availableTo`, `"HH:mm"`). Contains no customer data.

```json
{
  "locationId": "...",
  "locationName": "Main Branch",
  "categories": [
    {
      "id": "...", "name": "Starters",
      "items": [
        {
          "id": "...", "name": "Spring Rolls", "price": "199", "taxRatePercent": "5",
          "isVeg": true, "spiceLevel": "NONE", "allergens": [],
          "availableFrom": null, "availableTo": null,
          "modifierGroups": [
            { "id": "...", "name": "Dip", "minSelect": 0, "maxSelect": 1, "isRequired": false,
              "modifiers": [{ "id": "...", "name": "Sweet chilli", "priceAdjustment": "20", "isDefault": false }] }
          ]
        }
      ]
    }
  ]
}
```

### `POST /locations/:branchId/orders`

Scope: `orders:write`. Creates a takeaway or delivery order.

```bash
curl -X POST https://api.example.com/api/v1/integrations/locations/<branchId>/orders \
  -H "Authorization: Bearer $ORDERRESTRO_API_KEY" \
  -H "Idempotency-Key: 2f1a9a52-6c1c-4a39-9b0e-3f9e0f4c6d11" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "DELIVERY",
    "customerName": "Jane Doe",
    "customerPhone": "+91 98765 43210",
    "customerEmail": "jane@example.com",
    "delivery": { "address": "12 MG Road, Flat 4B", "pincode": "700001" },
    "scheduledFor": "2026-11-01T13:30:00Z",
    "notes": "Ring the bell twice",
    "items": [{ "menuItemId": "...", "quantity": 2, "modifierIds": [], "kitchenNote": "no onion" }]
  }'
```

| Field | Rules |
|---|---|
| `type` | `TAKEAWAY` (default) or `DELIVERY` |
| `customerName` | required, 1-80 chars |
| `customerPhone` | required, digits with optional `+`, spaces, `()`, `-` (6-20 chars) |
| `customerEmail` | optional, valid email |
| `delivery` | **required for `DELIVERY`**: `address` (5-300), `pincode` (3-12), optional `phone` (defaults to `customerPhone`) |
| `scheduledFor` | optional requested time, ISO 8601, at least 10 minutes ahead |
| `notes` | optional, up to 500 chars |
| `items` | 1-50 lines; `quantity` 1-99; up to 20 `modifierIds`; `kitchenNote` up to 200 |

**Totals are always computed by the server** from the current menu, modifier
prices, tax settings and the location's delivery zone. Any price, total, fee
or discount field in the request is ignored. If the location has delivery
zones, the pincode must fall inside one and the order must reach its minimum.
Orders arrive as "pending acceptance" unless the location auto-confirms.

**Idempotency.** Send an `Idempotency-Key` (8-64 characters of
`A-Z a-z 0-9 _ -`, a UUID is ideal) generated once per checkout attempt. A
retry with the same key, from the same API key, returns the original order
and creates nothing, including when two retries arrive at the same time. The
same key with a *different* body is refused with `422`, so generate a fresh
key per order. Without the header,
retries create duplicates.

The response is the order in the shape below (without customer details):

```json
{
  "id": "...", "orderNumber": "20261030-0007", "type": "DELIVERY",
  "status": "OPEN", "acceptance": "PENDING", "kitchenStatus": [],
  "createdAt": "...", "scheduledFor": null, "notes": null,
  "items": [{ "name": "Margherita", "quantity": 2, "unitPrice": 200, "lineTotal": 400,
              "kitchenNote": null, "modifiers": [] }],
  "totals": { "subtotal": 400, "tax": 19.05, "discount": 0, "deliveryFee": 40, "total": 440, "paid": 0 },
  "fulfillment": { "deliveryStatus": "UNASSIGNED", "etaAt": "...", "deliveredAt": null }
}
```

`fulfillment` is `null` for takeaway. `acceptance` is `PENDING`, `ACCEPTED` or
`REJECTED`; `status` is `OPEN`, `BILLED`, `PAID` or `CANCELLED`;
`deliveryStatus` is `UNASSIGNED`, `ASSIGNED`, `PICKED_UP`, `DELIVERED` or
`FAILED`. Prices are tax-inclusive (see ARCHITECTURE.md).

### `GET /locations/:branchId/orders/:orderId`

Scope: `orders:read`. Same shape as above, for polling an order's progress.
**An integration key can only read orders that key itself placed**; any other
order (staff, QR, kiosk, another key, another location) is a `404`.

Add **`?include=customer`** to also receive the details needed to fulfil it.
This needs the separate **`orders:read_customer`** scope; asking without it is
`403`. Without `include`, no personal data is ever returned.

```json
{
  "...": "everything above, plus:",
  "customer": { "name": "Jane Doe", "phone": "+91 98765 43210", "email": "jane@example.com" },
  "delivery": { "address": "12 MG Road, Flat 4B", "pincode": "700001", "phone": "+91 98765 43210" }
}
```

`delivery` is `null` for takeaway. Loyalty balances, wallet, allergy notes,
staff ids, tables and driver details are never part of an integration
response.

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

Online bookings through this endpoint are capped at what the location's two
largest tables can seat (e.g. a location with 4- and 6-seat tables caps
online bookings at 10 guests). A `guestCount` above that cap is rejected
with `400` and a message asking the guest to call the restaurant directly —
staff can still book any party size from the dashboard, where a host can
merge tables or make a judgment call the API can't. A location with no
tables configured yet has no cap applied.

### `GET /locations/:branchId/reservations/:reservationId`

Scope: `reservations:read`. Returns the reservation's current status
(`RESERVED`, `CONFIRMED`, `ARRIVED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`).

### Errors

Standard HTTP status codes: `401` missing/invalid/revoked key, `403`
missing scope or wrong location, `404` location/order/reservation not
found (also: an order this key did not place), `400` invalid request body
(`message: "Validation failed"` with an `issues` array), `409` conflict,
`413` body over 100 KB, `422` idempotency key reused with a different request, `429` rate limited (see `Retry-After`). Error bodies are
`{ "message": "...", "error": "...", "statusCode": ... }`.

### Rate limits

Each integration key is limited to **30 write requests/minute** (placing
orders and bookings) and **300 read requests/minute**, counted per key, so
they do not depend on client IPs behind a proxy or tunnel. Tune with
`INTEGRATION_WRITE_LIMIT_PER_MIN` / `INTEGRATION_READ_LIMIT_PER_MIN` on the
backend. The app-wide 300 requests/minute per-IP limit still applies on top.
JSON bodies are capped at 100 KB (`BODY_LIMIT`). A `429` carries `Retry-After`.

---

### `GET /locations/:branchId/delivery-quote?pincode=700001`

Scope: `menu:read`. Fee, minimum order and ETA for a delivery pincode, so a
website can show the price before the guest orders:

```json
{ "deliverable": true, "zoneName": "Central", "fee": 40, "minOrderAmount": 150, "etaMinutes": 30 }
```

`{ "deliverable": false }` when the pincode is outside every zone.

### Delivery and scheduled orders

`POST /locations/:branchId/orders` also accepts:

- `delivery` — `{ "address": "...", "pincode": "...", "phone": "..." }`.
  Always required for `type: "DELIVERY"`, and always stored on the order. If
  the location has delivery zones, the pincode must be inside one and the
  order must reach its minimum; the zone's fee is added at payment and shown in
  `totals.deliveryFee`. A location with no zones has no fee or zone check.
- `scheduledFor` — ISO time at least 10 minutes ahead. The kitchen ticket is
  released about 25 minutes before it (click & collect / pre-orders).

## 3. Webhooks (events pushed to your system)

Add one under **Settings > Webhooks**. Each request is a `POST` with a JSON
body `{ "event", "createdAt", "data" }` and these headers:

- `X-OrderRestro-Event` — the event name
- `X-OrderRestro-Delivery` — unique delivery id (use it to de-duplicate)
- `X-OrderRestro-Signature` — `t=<unix seconds>,v1=<hex>` where `v1` is the
  HMAC-SHA256 of `"<t>.<raw body>"` using the endpoint's signing secret
  (shown once when you create it). Reject requests older than 5 minutes.

Events: `order.created`, `order.paid`, `order.cancelled`,
`reservation.created`, `delivery.updated`, `campaign.message`.

Any 2xx response accepts a delivery. Anything else is retried after 1 min,
5 min, 30 min, 2 h and 12 h, then marked failed (visible in the log).

Webhook URLs must be `https`, and must not point at a private/internal
address. On a self-hosted LAN where the receiver is on the local network,
set `WEBHOOKS_ALLOW_PRIVATE=true` (and `WEBHOOKS_ALLOW_INSECURE=true` for
plain `http`) on the backend.

Verifying in Node:

```js
const crypto = require('crypto');
function verify(secret, rawBody, header) {
  const p = Object.fromEntries(header.split(',').map((x) => x.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;
  const mac = crypto.createHmac('sha256', secret).update(`${p.t}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(p.v1));
}
```

## Email

Campaign email is sent through your own SMTP server. Set on the backend:
`SMTP_URL=smtp://user:pass@host:587` and `SMTP_FROM="My Cafe <hello@mycafe.com>"`.
Without them, email campaigns refuse to send (nothing is queued silently).

## Two-factor authentication

Each user can turn on authenticator-app 2FA under **Settings > Security**.
`POST /api/v1/auth/login` then also needs `totp` (a 6-digit code or one
recovery code); without it the server answers `401 TWO_FACTOR_REQUIRED`.
PIN quick-login is refused for accounts that use it. An owner can reset a
staff member's 2FA from **Settings > Staff**. Secrets are stored encrypted
with a key derived from `JWT_SECRET` (or `TWO_FACTOR_KEY` if set) — keep that
value stable, or authenticator codes stop working until recovery codes are
used.

## Security model

- Integration keys carry **no staff identity** — a leaked key can only do
  exactly what its scopes and location allow, never anything a staff login
  could do beyond that.
- Personal (MCP) keys **inherit your exact role permissions** — revoke one
  immediately if you suspect it leaked, same as a password.
- Every key is shown in full exactly once, at creation. Only a masked last
  four characters are ever stored or displayed again.
- Keys can carry an optional expiry (`expiresAt`) and can be rotated from
  Settings > API Keys or `POST /api/v1/integration-api-keys/:id/rotate`.
- Revoking a key takes effect immediately — the next request with that key
  gets `401`.
- Customer phone/email/address are readable only with the dedicated
  `orders:read_customer` scope, only on orders the same key placed, and only
  when explicitly requested. Menu, location and public QR/kiosk responses
  never contain customer data.
- Limitations: the key is a bearer secret (anyone holding it has its scopes);
  orders are bound to the key that placed them (rotating a key moves them to
  the new one; creating a separate key does not); rate limiting is in memory and resets on
  restart. The `order.created` webhook payload still includes the delivery
  address and phone, delivered only to endpoints an admin configured and signed.
