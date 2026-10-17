# Customer kiosk and kitchen display (KDS) setup

This covers the self-service customer kiosk (a 23.8" landscape Android touchscreen,
RK3576 / Android 14 / 4 GB RAM) and the staff kitchen-display tablet (HONOR Pad X8a),
both served by the **same** OrderRestro instance. Nothing here needs an APK or a Play
Store listing: the kiosk is a browser page that can be added to the home screen as a
full-screen web app (PWA shortcut).

## 1. What was built

| Piece | Where |
|---|---|
| Public kiosk page | `/kiosk/<token>` (`apps/web/app/kiosk`, `apps/web/components/kiosk`) |
| Public API (anonymous, token-gated) | `GET /api/v1/public/kiosk/:token` (menu) and `POST /api/v1/public/kiosk/:token/order` (`apps/backend/src/modules/public/public-kiosk.*`) |
| Turn it on / rotate / off | **Settings → Customer kiosk** (owner/admin, `settings.manage`) |
| "Eat here" / "Take away" switches | Same card; if only one is on the choice screen is skipped |
| KDS station picker | Kitchen Display page (remembered per device and branch) |
| Staff scan field | Orders page: scan the kiosk ticket QR or type the order number |
| Database | One additive migration `20261017000000_kiosk` (branch kiosk token + flags, `orders.clientRequestId`) |

**Backward compatible:** with no token set the kiosk does not exist (404) and nothing else
changes. The only behaviour changes to existing screens are (a) the KDS gained optional
station chips, (b) realtime now always connects through the web origin (see §6), (c) the
`GET /public/menu/:qrToken` payload gained `taxRatePercent` per item.

## 2. Kiosk URL and launch

1. In the staff app: **Settings → Customer kiosk → Enable kiosk**. Copy the address, e.g.
   `https://orderrestro.nodedrdev.com/kiosk/<32 hex characters>`. The address *is* the
   credential: anyone who has it can place orders (and nothing else). **Create new address**
   invalidates the old one immediately; **Turn kiosk off** removes it.
2. On the kiosk (Android 14, Chrome): open that address → ⋮ menu → **Add to Home screen / Install app**.
   The generated manifest (`/kiosk/<token>/manifest.webmanifest`) opens that exact kiosk
   full-screen, landscape, in Spanish.
3. Use the **HTTPS** address. Service worker, install, and screen wake lock only exist in a
   secure context; over plain `http://192.168.x.x` the kiosk still works but without those.
4. Languages: Spanish by default after every customer; EN toggle in the header. The choice never
   persists and never touches the staff UI's saved language.

### Keeping the kiosk locked down and awake (separate from this code)
This app deliberately does **not** try to bypass Android's security. To stop customers leaving
the page, use the device's own tools: Android **screen pinning**, a kiosk browser (e.g. Fully
Kiosk Browser) or an MDM / device-owner policy pointing at the kiosk address, and disable the
status/navigation bars there. To keep the screen on permanently use the device's display
timeout / MDM "stay awake while plugged in" setting. As a courtesy the page requests a standard
Screen Wake Lock after the first touch of "Toca la pantalla para empezar" and also asks the
browser for full-screen on that tap; both are best-effort and silently skipped if refused.

## 3. Customer flow and rules

Welcome → eat here / take away (if both configured) → categories + search → options (required
groups enforced) → basket → review → **submit once** → big order number, shown for 25 s (or until
"Nuevo pedido"), then a clean start screen.

- **Money is server-side.** The browser sends only item ids, quantities and option ids. Prices,
  options, tax (Spain **IVA**, inclusive/exclusive per branch) and totals are recomputed by the same
  `OrdersService` the POS uses. The on-screen basket total is a preview; the confirmation shows the
  server's figures. Currency/locale use the restaurant's currency with the existing `formatCurrency`.
- **Exactly one order per basket.** Each basket carries a UUID idempotency key
  (`orders.clientRequestId`, unique per branch). A retry or a double-tap returns the original order.
  After a network/5xx failure the basket is locked and the only options are **Reintentar** (same key)
  or **Empezar de nuevo**, because the server may already have the order.
- **Unavailable product** → the server answers `409 ITEM_UNAVAILABLE`; those lines are removed, the
  customer is told, and the menu is re-fetched. **Empty menu**, **server unreachable**, **kiosk
  switched off**, **browser offline**, **rate limit** and **validation** each have their own screen/message.
- **Not paid.** Kiosk orders are created `OPEN` with channel `ONLINE`, type `KIOSK`, no acceptance gate
  (they go straight to the KDS). Nothing on the kiosk marks anything paid; payment is taken at the
  counter with the configured payment flow. A printer or scanner result never changes payment state.
- **No personal data.** No name, phone, e-mail or account is requested. The response contains no ids
  or staff data. Idle for 60 s (+15 s warning) clears the basket.
- **Live connection required.** There is no offline order queue. The service worker caches only the
  static app shell and icons (`/kiosk/sw.js`, scope `/kiosk/`); it never touches `/api`, never stores
  menu/prices/orders, and a cached screen is never treated as proof of an order.

## 4. HONOR Pad X8a — kitchen display handoff

Install nothing special.
1. Open the **same instance URL** (the HTTPS one) in Chrome.
2. Sign in with a **least-privilege kitchen account**: create a staff member with the
   `KITCHEN_STAFF` role (permission `kds.manage` only — it sees tickets, not settings, orders,
   customers or the kiosk token).
3. Open **Kitchen Display** and press the chip for the station this tablet serves (e.g. *Bar*,
   *Main Kitchen*). It is remembered on that tablet. "All stations" shows everything.
4. Rotate to landscape and keep it awake while charging (Settings → Display → Screen timeout, or
   Developer options → Stay awake while charging).
5. New kiosk tickets appear live over the socket connection with a sound; the card shows
   `#<order number>`, `KIOSK · <station>`.

## 5. Printer and scanner — what is and is not verified

**No physical printer or scanner was available. Everything below marked "unverified" has only been
exercised in a desktop browser, not on the RK3576 / the real devices.**

| Item | Status |
|---|---|
| Customer ticket, 80 mm layout (`@page size: 80mm auto; margin 0`, 72 mm column), shows "NO PAGADO", includes an order QR | Layout verified in unit tests and a desktop Chromium render. |
| Printing from Android Chrome | **Unverified.** The button only opens the browser print dialog (`window.print()`); it can't print silently and can't tell whether a printer exists. Requires an Android print service for the printer (vendor plugin / Mopria). If `window.print` is missing the screen says printing is unavailable. Paper-cut behaviour depends on the driver: **unverified**. |
| Direct USB ESC/POS | Exists in the backend but only for a Linux **host** with USB passthrough (`escpos-usb.ts`). It does **not** run on Android and is **not** used by the kiosk. |
| Silent print / Bluetooth / built-in printer / cash drawer from the kiosk | **Not implemented, not claimed.** Would need a small Android companion app or WebView bridge; see below. |
| QR/barcode scanner as USB-HID keyboard wedge | **Unverified** on hardware; implemented as a plain focused text field on **Orders** (`lib/scan.ts`): strips scanner control characters, accepts only `orderrestro:order:<number>`, a bare order number, or a table-QR URL, rejects everything else, and only *opens* the order. Typing the number is the manual fallback. |
| Scanner with a camera/SDK/serial (SPP) interface | Not supported; no camera API is assumed. |

### Facts needed from the vendors for direct integration
- **Printer:** exact make/model, connection (internal serial, USB, Bluetooth, LAN), command set
  (ESC/POS? vendor SDK?), code page for ñ/€/accents, cutter and drawer-kick commands, and whether an
  Android print service exists for it. Then a separately scoped companion app / `WebView` JS bridge
  (Android permissions: USB host or Bluetooth) behind a feature flag, keeping `window.print()` as the fallback.
- **Scanner:** make/model, interface (HID keyboard / SPP / SDK), configured prefix/suffix (we expect a
  trailing Enter), supported symbologies, and what the intended QR payload is (customer loyalty? order ticket?).

## 6. Deployment notes
- Use the existing architecture: same-origin `/api` and `/socket.io` proxy in the web container. The
  backend and database ports stay unpublished; cookies/`COOKIE_SECURE` unchanged.
- Realtime now always connects to the page's own origin. Previously, over plain HTTP, the client tried
  `http://<host>:4001`, which the shipped compose stack does not publish, so tickets only refreshed on
  the 20 s poll. Set `NEXT_PUBLIC_WS_URL` at build time to override.
- `GET /api/v1/public/kiosk/:token` is throttled to 60/min/IP and the order POST to 20/min/IP.

## 7. Tests and how to run them
```bash
pnpm install && pnpm --filter @nodedr-restaurant/types build
(cd apps/backend && npx tsc --noEmit && npx jest)                        # unit incl. kiosk service
(cd apps/web && npx tsc --noEmit && npx eslint . && npm test)            # node:test: basket, flow reducer, scan, ticket
# API integration against a real, migrated + seeded Postgres:
cd apps/backend && npx prisma migrate deploy && npx ts-node prisma/seed.ts
KIOSK_E2E=1 npx jest --config ./test/jest-e2e.json kiosk --forceExit
# Browser flow (Playwright, Python): kiosk 1920x1080 + 1280x720, tablet/portrait/phone widths, KDS handoff, scanner fallback
KIOSK_URL=https://<host>/kiosk/<token> SHOTS=./shots python3 apps/web/e2e/kiosk_flow.py
```
Hardware-only checks still **pending**: real RK3576 touch/DPI behaviour in Android Chrome, install-as-app
and full-screen, wake lock, Android print dialog → 80 mm printer and cutter, scanner wedge input,
HONOR Pad X8a rendering and sound autoplay policy.
