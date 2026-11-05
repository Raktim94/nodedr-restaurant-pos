# Online payment gateways

Settings → **Payments** lets a restaurant take card / UPI / wallet payments through a
payment provider. The customer pays on the **provider's own hosted page**; OrderRestro
never sees or stores card numbers, CVVs or any card data.

## What works today

| Provider | Countries in the catalog | Integration | Status |
|---|---|---|---|
| Razorpay | IN | Hosted Payment Link + refunds | Implemented. Signature verification, amount checks and settlement logic unit-tested. **Not yet run against a live Razorpay account** (only auth failure was seen against the real API) |
| Stripe | US, GB, ES | Hosted Checkout Session + refunds | Same status |
| Cashfree Payments | IN | Hosted Payment Link | Same status, plus: the webhook body shape is taken from Cashfree's docs (which differ across API versions) and was not exercised live. Confirmation never depends on it: the server always re-reads the link from Cashfree, and the customer return page triggers that re-read too |
| PayU, CCAvenue, BillDesk, PayPal/Braintree, PayPal, Square, Adyen, Worldpay, Checkout.com, Redsys, PAYCOMET, PhonePe | listed | none | **Listed for reference only. OrderRestro cannot take payments through them yet** and refuses to store credentials for them |

"Implemented" is not "supported": before relying on a gateway in production, run one Test
payment end to end with your own sandbox account (see *Trying it*).

**Refunds:** Razorpay and Stripe refunds can be sent from OrderRestro (below). Cashfree refunds are made in
Cashfree's dashboard and recorded here as an *Other* refund. Test payments cannot be refunded (no money moved).

## Setup flow

1. **Choose your business country.** Only that country's gateways are shown (up to five).
   This filters the list; it does not decide where you may open an account. Availability,
   merchant approval, payment methods and settlement depend on the provider's current
   rules and your merchant account.
2. **Choose a gateway** (or add a *Custom provider*: a reference entry, or a pointer at one
   of the integrations above for a country not in the catalog).
3. **Enter credentials** — only the fields that provider needs. *Test* and *Live* credentials
   are stored separately. Secrets are write-only: after saving they show as "Saved" and can only be
   replaced or deleted. Keys of the wrong mode (a `rzp_live_` key in the Test slot, `sk_live_` for
   Test…) are rejected.
4. **Add the webhook** in the provider's dashboard using the URL shown for that mode. Test and
   Live have different URLs.
5. **Test connection**, then switch **Accept online payments** on. One gateway collects at a time.
6. Mode starts as **Test**. Going **Live** needs complete Live credentials, a passing credential
   check and typing `ENABLE LIVE PAYMENTS`.

## What Test mode means

A Test payment proves the wiring (link created, provider reached, webhook verified, status read
back). It moved **no real money**, so it does **not** mark the bill as paid. The UI says so.

## How a payment is confirmed

1. The cashier taps *Create payment link*. The **server** computes the balance from the bill
   (the client never sends an amount), converts it to integer minor units and creates the
   provider's hosted page. An open link for the same bill is reused, not duplicated.
2. The customer pays. The provider sends a webhook and redirects the customer to `/pay/return`.
3. **Neither is trusted for the outcome.** The webhook is verified (provider's documented
   signature scheme over the raw body, with a replay window where the provider supports one);
   it only names the payment. The server then asks the provider for the payment's real state with
   the merchant's secret key. Only if the provider says *paid*, in the *same currency*, for *exactly the amount
   requested*, is the bill settled.
4. Settlement is idempotent: an atomic claim plus the checkout `requestId` mean retries, duplicate
   webhooks and out-of-order events cannot double-pay. Duplicate event ids are recorded and ignored.
5. If money arrived but the bill cannot take it (edited, cancelled, already paid) or the provider
   reports a different amount, the payment is flagged **Needs review** in Settings → Payments;
   it is never silently dropped or applied.

## Refunds through the gateway

Orders → Refund. If the order was paid by an online payment, the dialog defaults to **Send it back to the
customer's original payment** (switch it off to refund by cash/UPI/store credit as before). The server:

1. checks the order and the payment can both still take that amount (cap = what the payment has not already
   refunded or reserved; cap = what the order still allows);
2. **reserves** the amount, then calls the provider **once** (Stripe with an idempotency key; Razorpay has none,
   so it is never retried automatically);
3. records the local refund (reports, stock return, VERI*FACTU) **only after the provider accepts it**.

Ambiguous outcomes are never guessed: a timeout, or the provider refunding but the local record failing, is
shown under **Settings → Payments → Refunds needing review** with what to check. Do not refund again until you
have looked in the provider dashboard. Needs the `refunds.process` permission.

## Secrets

* Stored in the database encrypted with AES-256-GCM, bound to restaurant + provider + mode.
* The key comes from **outside** the database: `INTEGRATION_SECRET_KEY`, or a mounted file named by
  `INTEGRATION_SECRET_KEY_FILE`. If neither is set it is derived from `JWT_SECRET` (set a dedicated
  key before storing live credentials, so rotating the JWT secret never strands them).
* Never returned by any API, never logged, never in audit rows, never sent to the browser or the
  Android app (the app is a thin client of your server; keys exist only on the server).
* `PUBLIC_BASE_URL` (or the first `CORS_ORIGIN`) is used for return and webhook URLs. A
  browser-supplied origin is honoured only if it is in `CORS_ORIGIN`.

### Docker
```yaml
# .env
INTEGRATION_SECRET_KEY=<long random string>      # or
INTEGRATION_SECRET_KEY_FILE=/run/secrets/integration_key
PUBLIC_BASE_URL=https://pos.example.com
```
Mount the secret file into the `backend` service (compose `secrets:` or a bind mount).

### Linux / Windows (.deb, MSIX, installer)
Set the same variables in the backend's environment file (Linux: the systemd `EnvironmentFile`;
Windows: machine environment variables or the service's environment) and restart the backend.
Webhooks need a URL reachable from the internet (Cloudflare Tunnel works).

### Android
The Android app uses your server's settings screens; there is nothing to configure in the app and
no payment secret is ever present on the device. Payment links open in the browser or are scanned
as a QR code.

## Maintaining the catalog

Built-in rows live in `apps/backend/src/payment-gateways/catalog-data.ts` (with the research date
and sources) and are refreshed into the `payment_gateway_catalog` table at start-up. A restaurant admin can add
its own entries (Custom provider). To add a gateway's *behaviour*, write an adapter implementing
`PaymentGatewayAdapter` (`adapters/adapter.ts`), register it in `adapters/registry.ts`, and name it in the
catalog. No other payment code changes.

### Research record (2026-11-05)
Selection criteria: hosted checkout/payment-link API usable without handling card data; established
acquirer or aggregator serving merchants in that country per its own docs or regulator; documented
developer API. The order is not a ranking. Vendor docs were read for Razorpay, Stripe and Cashfree;
the others were only checked for country availability. Stripe is not listed for India because its
availability there was limited/invite-only in the sources checked. PhonePe is in the catalog but off
by default (onboarding requirements not confirmed). Square, Adyen, Worldpay and Checkout.com country
availability was not re-verified. Sources are stored on each catalog row and shown in the API.

## Trying it

Use each provider's sandbox: Razorpay/Stripe test keys; Cashfree sandbox keys. Create a bill at the
POS, press *Create payment link* in the checkout panel, pay with the provider's test instrument,
and watch Settings → Payments → Recent online payments show *Paid* with "Test (no real money)".
