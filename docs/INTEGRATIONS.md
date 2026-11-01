# Integrations hub

Settings → Integrations lets a restaurant connect OrderRestro to outside
platforms **using its own accounts and credentials**. Nothing routes through a
central Nodedr server; the credentials belong to the restaurant and are stored
on its own installation, encrypted.

## What works today

| Piece | State |
|---|---|
| Hub: connect, configure, test, enable/disable, disconnect, activity log | Working, tested |
| Encrypted credential storage (AES-256-GCM, bound to restaurant + provider) | Working, tested |
| Outgoing webhooks (HMAC-signed, retries, delivery history) | Working (Settings → Webhooks) |
| Incoming orders / API access (scoped, expiring, rotatable keys) | Working (Settings → API Keys; `/api/v1/integrations/*`) |
| **Zomato, Swiggy** | **Credentials can be saved. Order sync is not active.** |

Zomato and Swiggy only integrate with restaurants through partner programmes.
The adapters for them (`providers/partner-api.provider.ts`) have **no verified
client for either order API**, so they cannot receive orders, change an
order's status, or confirm the credentials work. `testConnection` therefore
never reports *Connected*; it reports *Pending configuration* and says why.
Do not change that until an adapter has been exercised against the platform's
sandbox with real, authorised credentials.

## Statuses

`NOT_CONNECTED`, `PENDING_CONFIGURATION`, `CONNECTED`, `SYNC_ERROR`,
`AUTH_EXPIRED`, `DISABLED`. Only an adapter's own `testConnection` can set
`CONNECTED`; saving credentials never does.

## Writing an adapter

1. Implement `IntegrationProvider` (`src/integration-hub/providers/provider.ts`):
   `key`, `name`, `category`, `capabilities`, `credentialFields`, and
   `testConnection`. Implement the optional methods (`updateOrderStatus`,
   `processWebhook`, `refreshCredentials`) only for capabilities you set to
   `true` — the hub never calls an operation the adapter did not declare.
2. Register it in `providers/registry.ts`.
3. Add tests next to `test/integration-hub.e2e-spec.ts`.

Nothing in POS, KDS or order management changes: an adapter that receives
orders should create them through the existing order service as an ONLINE order
requiring acceptance, setting `externalSource` + `externalOrderId` (unique per
branch, so a retried delivery cannot create a second order) and
`externalCustomerRef`. Those columns already exist on `Order`.

## Security rules for adapters

- Credentials arrive decrypted only inside `ProviderContext` for one call;
  never log them or put them in an error message.
- Only use the platform's official API with credentials issued to the
  restaurant. No scraping, private endpoints or browser automation.
- Validate any callback URL (see `modules/webhooks/net-guard.ts` for the SSRF
  guard) and verify webhook signatures with a constant-time comparison, a
  timestamp window and replay protection.

## Configuration

`INTEGRATION_SECRET_KEY` (16+ characters) is the encryption key. If unset, a
key is derived from `JWT_SECRET`, which means **rotating `JWT_SECRET` makes
saved credentials unreadable** (the hub then reports *Authentication expired*
and asks for them again). Set a dedicated key in production and back it up.

## Permissions

All hub routes need `settings.manage`. The restaurant is always taken from the
signed-in session, never from the request.
