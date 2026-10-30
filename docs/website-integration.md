# Connecting your own website (Next.js on `www`, OrderRestro behind a Cloudflare Tunnel)

The common setup: the public site lives on separate hosting at
`www.example.com`; OrderRestro runs on a machine in the restaurant and is
reached from the internet through a Cloudflare Tunnel at `api.example.com`.

```
Visitor's browser ──HTTPS──▶ www.example.com  (Next.js, any host)
                                   │  server-side only, Authorization: Bearer <key>
                                   ▼
                      https://api.example.com/api/v1/integrations/...
                                   │  Cloudflare Tunnel (outbound from the restaurant)
                                   ▼
        cloudflared ─▶ web:3000 (OrderRestro web) ─▶ backend:4000 ─▶ postgres:5432
                                   └── only `web` is reachable; the rest stay on the private Docker network
```

The browser never talks to OrderRestro and never sees the key: it calls the
website's own backend, which calls OrderRestro.

## 1. Create the key

**Settings > API Keys > Integration API keys > New key.** Lock it to one
location and tick only what the site needs:

| Scope | Why |
|---|---|
| `locations:read`, `menu:read` | show the menu and delivery quote |
| `orders:write` | place orders |
| `orders:read` | status, items, totals |
| `orders:read_customer` | **only** if the backend must read back the customer's mobile and delivery address |

The key is shown once. Put it in the website backend's environment only.
Optionally give it an expiry (`expiresAt` when creating via the API); an
expired key is refused like a revoked one. **Rotate** a key regularly, or at
once if exposed, with the Rotate button (or `POST /api/v1/integration-api-keys/:id/rotate`):
it issues a new secret with the same scopes and location, moves the old key's
orders to it so status and customer lookups keep working, and revokes the old
key immediately. Update the website's environment with the new secret.

## 2. Expose OrderRestro with a Cloudflare Tunnel

1. Add the domain to Cloudflare. In **Networking > Tunnels** create a
   remotely-managed tunnel and install `cloudflared` on the OrderRestro machine
   (the dashboard shows the exact command with your token).
2. On the tunnel's **Routes** tab choose **Add route > Published application**:
   subdomain `api`, domain `example.com`, **Service URL**:
   - `http://localhost:1995` if `cloudflared` runs on the host (1995 is the
     default `HOST_PORT` of the `web` container), or
   - `http://web:3000` if `cloudflared` runs as a container on the compose
     network (below).
   Cloudflare creates the proxied `api` DNS record for you; HTTPS is
   terminated at Cloudflare, and the tunnel only makes outbound connections
   (the machine needs to reach Cloudflare on port 7844).
3. Point **only** at the web container. Do not add routes to `backend:4000` or
   `postgres:5432`, and do not publish those ports: in `docker-compose.yml`
   they use `expose`, not `ports`, and the web container proxies `/api` and
   `/socket.io` to the backend itself.

Optional: run `cloudflared` as a compose service (put the token in `.env`,
never in git):

```yaml
# docker-compose.override.yml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?set in .env}
    depends_on: [web]
```

### OrderRestro `.env` for HTTPS behind the tunnel

```env
COOKIE_SECURE=true                      # staff logins over https://api.example.com
FRONTEND_ORIGIN=https://api.example.com # the origin the dashboard is served from
JWT_SECRET=<openssl rand -hex 32>
# TRUST_PROXY=                           # leave unset (see below)
```

- **Public base URL** for the website: `https://api.example.com` (no port).
  The API root is `https://api.example.com/api/v1/integrations`.
- **Cookies.** `COOKIE_SECURE=true` marks the staff session cookie `Secure`.
  Set it only once you reach the dashboard over HTTPS. For LAN access over plain
  `http://192.168.x.x:1995`, the browser will not store a Secure cookie, so
  staff on the LAN should use `https://api.example.com` too (it works from
  inside the LAN), or you keep `COOKIE_SECURE=false` and not use the tunnel for
  the dashboard. The Integration API uses Bearer keys, not cookies, so it is
  unaffected, and there is no CSRF exposure on it.
- **Proxy headers.** The backend ignores `X-Forwarded-*` unless `TRUST_PROXY`
  is a number of hops (never `true`; anything else stops the backend from
  starting). Measured behaviour of the web container: its `/api` proxy passes an
  incoming `X-Forwarded-For` through **unchanged** and adds nothing, and the
  backend's direct peer is the web container. So with `TRUST_PROXY=1` the
  backend takes the right-most `X-Forwarded-For` entry, which Cloudflare sets to
  the visitor's address (a value a visitor sends is placed to its left and
  ignored). Cloudflare appending rather than replacing the header is its
  documented behaviour and was not tested here. Set `TRUST_PROXY=1` only if
  *all* traffic arrives through the tunnel: a LAN client reaching the web
  container directly could send its own `X-Forwarded-For` and choose the
  address the per-IP limiter sees. It is left unset by default so LAN-only
  installs are unchanged. Integration limits are per API key and never depend
  on it.
- **CORS.** Not needed: the website's backend calls the API server-to-server,
  and the dashboard is same-origin. `CORS_ORIGIN` / `FRONTEND_ORIGIN` accept a
  comma-separated list of exact origins (never `*`). Only add the `www` origin
  if you deliberately call the API from browser JavaScript, which would mean a
  key in the browser. Do not do that.
- **Realtime (Socket.IO).** The staff dashboard, KDS and kiosk use
  `/socket.io` on the same origin, which the web container proxies. Cloudflare
  Tunnel carries WebSockets; Socket.IO starts with long-polling and upgrades
  when it can, so the dashboard works either way. The website does not need it.
- **Swagger** (`/api/docs`) is off in production unless `ENABLE_SWAGGER=true`.
  Leave it off on a public hostname.
- **LAN access keeps working.** Staff can still use `http://<machine-ip>:1995`
  (with `COOKIE_SECURE=false`) or the tunnel hostname; nothing needs the
  internet except the public site's calls. If the internet drops, the POS, KDS
  and local ordering carry on; the website simply cannot reach the API until the
  tunnel reconnects (surface a "ordering unavailable" state, do not queue
  silently).

For stricter protection of the public hostname, add a Cloudflare WAF/rate
limiting rule on `api.example.com/api/v1/integrations/*`, or restrict it with
Cloudflare Access service tokens, as an extra layer in front of the key.

## 3. Next.js: call it from the server only

```env
# .env.local on the website (server-only: no NEXT_PUBLIC_ prefix!)
ORDERRESTRO_URL=https://api.example.com
ORDERRESTRO_API_KEY=ordr_ext_xxxxxxxxxxxxxxxxxxxxxxxx
ORDERRESTRO_LOCATION_ID=<location id>
```

```ts
// lib/orderrestro.ts
import 'server-only';

const base = `${process.env.ORDERRESTRO_URL}/api/v1/integrations`;

export async function orderrestro<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const { idempotencyKey, ...rest } = init;
  const res = await fetch(`${base}${path}`, {
    ...rest,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${process.env.ORDERRESTRO_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  });
  if (!res.ok) throw new OrderrestroError(res.status, await res.text());
  return res.json() as Promise<T>;
}

export class OrderrestroError extends Error {
  constructor(public status: number, public body: string) {
    super(`OrderRestro ${status}`); // never put request data (phone/address) in the message
  }
}
```

```ts
// app/api/order/route.ts   (the browser posts here, never to OrderRestro)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { orderrestro, OrderrestroError } from '@/lib/orderrestro';

const loc = process.env.ORDERRESTRO_LOCATION_ID!;
const Body = z.object({
  idempotencyKey: z.string().uuid(), // generated once when the checkout page loads
  type: z.enum(['TAKEAWAY', 'DELIVERY']),
  customerName: z.string().min(1).max(80),
  customerPhone: z.string().min(6).max(20),
  customerEmail: z.string().email().optional(),
  delivery: z.object({ address: z.string(), pincode: z.string() }).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({
    menuItemId: z.string(),
    quantity: z.number().int().min(1).max(99),
    modifierIds: z.array(z.string()).optional(),
  })).min(1),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid order' }, { status: 400 });
  const { idempotencyKey, ...order } = parsed.data; // no prices: the server prices the order
  try {
    const placed = await orderrestro<{ id: string }>(`/locations/${loc}/orders`, {
      method: 'POST',
      body: JSON.stringify(order),
      idempotencyKey,
    });
    return NextResponse.json({ id: placed.id }, { status: 201 });
  } catch (e) {
    if (e instanceof OrderrestroError && e.status === 400)
      return NextResponse.json({ error: 'Please check your order and address' }, { status: 400 });
    return NextResponse.json({ error: 'Ordering is unavailable right now' }, { status: 502 });
  }
}
```

```ts
// app/api/order/[id]/route.ts  (status page; add your own check that this
// visitor owns the order, e.g. a signed cookie set when they placed it)
import { NextResponse } from 'next/server';
import { orderrestro } from '@/lib/orderrestro';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await orderrestro<any>(
    `/locations/${process.env.ORDERRESTRO_LOCATION_ID}/orders/${encodeURIComponent(id)}`,
  );
  // Public status page: return only what the visitor needs.
  return NextResponse.json({ status: order.status, acceptance: order.acceptance,
    deliveryStatus: order.fulfillment?.deliveryStatus ?? null, totals: order.totals });
}

// Backend-only fulfilment lookup (customer mobile + address), e.g. for your own
// notification job. Requires the orders:read_customer scope; never forward this
// to the browser:
//   orderrestro(`/locations/${loc}/orders/${id}?include=customer`)
```

Order IDs are unguessable but not secret, so the website must prove a visitor
placed an order before showing it. A minimal pattern: after a successful POST,
set an HMAC-signed, HttpOnly cookie holding the order id, and require it on the
status route.

```ts
// lib/order-access.ts
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const secret = () => process.env.ORDER_COOKIE_SECRET!; // openssl rand -hex 32, server-only
const sign = (id: string) => createHmac('sha256', secret()).update(id).digest('base64url');

export async function grantOrderAccess(id: string) {
  (await cookies()).set(`ord_${id}`, sign(id), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/api/order', maxAge: 60 * 60 * 24,
  });
}

export async function hasOrderAccess(id: string) {
  const got = (await cookies()).get(`ord_${id}`)?.value ?? '';
  const want = sign(id);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
// POST handler: after `placed`, `await grantOrderAccess(placed.id)`.
// GET handler: `if (!(await hasOrderAccess(id))) return new Response(null, { status: 404 });`
```

Never relay the `customer` / `delivery` fields to anyone but the person who
placed the order.

## 4. Check it works

```bash
curl -sS -H "Authorization: Bearer $ORDERRESTRO_API_KEY" \
  https://api.example.com/api/v1/integrations/locations        # 200 with your key
curl -sS -o /dev/null -w '%{http_code}\n' https://api.example.com/api/v1/integrations/locations  # 401 without
curl -sS -o /dev/null -w '%{http_code}\n' https://api.example.com/api/docs                        # 404 in production
nc -vz <public-ip-of-the-machine> 4000                                                            # must not connect
```

## What this does and does not protect

Added: a dedicated scope for personal data; orders readable only by the key
that placed them; allow-listed responses; server-side pricing; idempotent order
creation; per-key rate limits; request size cap; strict input validation;
configurable trusted-proxy hops; an explicit CORS origin list.

Not covered: a stolen key works until it expires, is rotated or is revoked
(keep it server-side; use expiry and rotation to shorten exposure); rate limits
are in memory per process and reset on restart; the `order.created` webhook
still carries the delivery address and phone to endpoints an admin configured
(fulfilment systems need them; do not point it at anything you do not control);
data on the restaurant's machine is as safe as that machine. Review before
relying on it for anything beyond the described flow.
