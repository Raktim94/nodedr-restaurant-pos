# OrderRestro mobile app: Play Store and App Store plan

Status (2026-11-02, version 1.15.0): **built**, see `mobile/README.md`. Android debug and signed release builds run on an emulator; the iOS project is written but not compiled; store submission still needs the owner's accounts, a Firebase project and a public demo server. The sections below are the original plan.

What differs from the plan: the app opens the restaurant's own web app in the native shell (Capacitor `server.url`, chosen at runtime) instead of bundling the web build, so the web UI stays in one place. Offline support is a banner plus a queue for rider status updates (`apps/web/lib/outbox.ts`); a phone-side database cache and the `/v1/mobile/changes` and `/v1/mobile/outbox` endpoints were not built.

## 1. What we are shipping

One app, **OrderRestro**, for Android and iOS. It is the staff and rider app, using the same login as the web app (email or phone plus password).

| Role | What they get on the phone |
|---|---|
| Rider (Delivery staff) | My deliveries, go online, live location, navigate, call, mark picked up / delivered / failed |
| Waiter / cashier | Orders, accept or decline online orders, tables, take an order, kitchen status |
| Owner / manager | Dashboard, pending orders with address and Google Maps link, change all prices, reports summary |
| Kitchen | Kitchen display on a tablet |

A second, optional app for **customers** (white-label per restaurant, PKUSS first) can reuse the same shell later. It is not part of the first submission.

## 2. "Works locally and syncs with the server"

A phone cannot run the Postgres database that the restaurant computer runs, so "local" means two things:

1. **On the restaurant WiFi, no internet needed.** The app connects straight to the restaurant computer (`http://<machine>:1995`) found by an address the owner types or a QR code shown in Settings. This is how the product already works, so billing and the kitchen keep going when the internet is down.
2. **On the phone, when the connection drops.** The app keeps working from a local copy and sends the changes when the connection returns.

What the phone stores and does offline:

| Data | Offline behaviour |
|---|---|
| Menu, tables, today's orders | Cached on the phone (SQLite), refreshed on every connect |
| New order taken offline | Saved in an outbox with an Idempotency-Key, sent when back online, never duplicated |
| Rider status changes (picked up, delivered) | Queued in the outbox, applied in order, the server rejects any that are no longer valid |
| Payments, refunds, price changes | Online only, on purpose. Money actions are not queued |

The server already has two-way sync between a Windows install and a central server (Settings > Server Sync). It copies database rows with triggers and is meant for servers, not phones. Phones use a smaller REST path instead:

- `GET /v1/mobile/changes?since=<cursor>` returns changed menu, tables and orders for the branch the user may see, paged.
- `POST /v1/mobile/outbox` takes a batch of queued actions, each with an Idempotency-Key, and returns one result per action.
- Conflicts: the server wins for anything money-related and for orders already accepted or paid. The phone shows what was refused and why.
- Every call is permission-checked as the signed-in user, the same as the web app.

## 3. Technology choice

**Capacitor around the existing Next.js web app, plus native plugins.** The staff UI already exists, is tested and is translated, so a rewrite in React Native would take months and diverge from the web app.

- The web app is exported as a static bundle that ships inside the app, so it opens instantly and offline. It talks to the server address the user chose.
- Native plugins: push notifications (FCM and APNs), background and foreground location (riders), camera (scan QR to connect, scan order QR), biometric unlock, haptics and sound for new orders, secure storage for the login token, share sheet, open maps.
- Offline store: SQLite through a Capacitor plugin, behind a small data layer so web and app share code.
- Apple is strict about apps that are only a website in a frame (guideline 4.2). The native features above are what make this a real app, so they are part of the first release, not extras.

Alternative considered: React Native / Expo. Better native feel, but it means rebuilding every screen. Not recommended unless the Capacitor build feels slow on low-end Android phones during the spike.

## 4. Phases

| Phase | Work | Rough effort |
|---|---|---|
| 0. Spike | Capacitor shell opens the web app on a real Android phone and an iPhone, connects to a LAN server, login works, rider screen gets location | 3 to 4 days |
| 1. Connect and sign in | Server address screen with QR scan, saved servers, biometric unlock, sign out, delete account, app icon and splash, dark mode | 1 week |
| 2. Native features | Push for new online orders and new deliveries (backend sends via FCM/APNs, device tokens stored per user), sound and vibration, location for riders, open in Google Maps | 1.5 weeks |
| 3. Offline | Mobile change feed and outbox endpoints, SQLite cache, outbox with retry, "offline" banner, tests for duplicate sends and conflicts | 2 weeks |
| 4. Polish | Phone-first layouts for orders, delivery, dashboard (dashboard done in 1.14.1), tablet layouts for kitchen display, accessibility pass, performance on a low-end Android phone | 1.5 weeks |
| 5. Store prep | Accounts, listings, screenshots, privacy and data forms, review demo server, signing, CI builds | 1 week, mostly waiting on accounts |
| 6. Beta | Internal testing, then closed testing with real PKUSS riders and staff, fix, then submit | 2 weeks |

About 9 to 10 weeks of work for one developer, with store approvals on top (Play: hours to a few days; Apple: usually 1 to 3 days, longer after a rejection).

## 5. What the store submissions need

Accounts and money
- Google Play developer account: one-time US$25. Register as an **organization** (NODEDR INFOTECH PRIVATE LIMITED, needs a D-U-N-S number). New personal accounts must run a closed test with 12 testers for 14 days before production; organization accounts avoid that.
- Apple Developer Program: US$99 a year, also as an organization (D-U-N-S again). Building and submitting iOS needs a Mac with Xcode, or a cloud Mac build service. Nothing in the current setup builds for iOS.

Both stores
- App name, short and full description, icon, feature graphic (Play), 5 or more screenshots per device size, support URL and email (info@nodedr.com), marketing URL (orderrestro.nodedr.com), privacy policy URL (already on the site, needs a mobile section).
- **A review login that works.** OrderRestro is self-hosted, so the reviewers need a public demo server with sample data and a staff and a rider account. Without it the app is rejected as "cannot be used". Plan: a small demo instance on `mail` or a VPS, reset nightly.
- **Account deletion** inside the app and on a web page (required by both stores).
- Age rating, content rating, export compliance (the app uses standard HTTPS only).

Google Play specifics
- Target the current required Android API level at submission time. Build an Android App Bundle (.aab). Enrol in Play App Signing.
- Data safety form: location (riders), phone number, name, device ID for push, all linked to the account and not sold.
- **Location**: riders need location while on a delivery. Foreground use with a visible notification is the safe path. Background location needs a separate declaration and a demo video, so the first release shares location while the app is open, as the web version does today.
- Notification and full-screen-intent permissions: only ask for what is used.

Apple specifics
- Privacy "nutrition labels" and a privacy manifest for the app and each SDK.
- Permission texts for location, camera, notifications and Face ID, written plainly.
- Sign in with Apple is **not** needed because there is no third-party social login.
- No in-app purchases. The app is free and has no payments for digital goods.
- Push needs an APNs key. Background modes only if actually used.
- App Review notes explaining the self-hosted model and the demo server.

Store listing wording avoids claiming "certified" tax compliance (VERI*FACTU stays "implemented, not certified").

## 6. Backend work this needs

1. `DeviceToken` table and `POST /v1/devices` / `DELETE /v1/devices/:id`; remove tokens at sign out and on account deletion.
2. Push sender service (FCM HTTP v1 for Android, APNs for iOS, or FCM for both). Triggered from the existing events: new online order, order accepted, rider assigned. Settings switch to turn it off. Self-hosted owners add their own FCM and APNs keys, or use a NodeDR push relay (decision below).
3. Mobile change feed and outbox endpoints (section 2) with tests.
4. Account deletion endpoint that removes personal data and keeps the financial records the law requires.
5. A connect QR in Settings that encodes the server address.
6. Rate limits and a minimum-app-version header so old builds can be told to update.

## 7. Release and CI

- `mobile/` folder in this repo (Capacitor project) next to `apps/` and `packages/`.
- GitHub Actions: Android build and signed .aab on every `v*` tag; iOS build on a macOS runner with signing through fastlane match. Upload to Play internal track and TestFlight automatically. Production promotion stays manual.
- Version numbers follow the server (1.14.x) with a separate build number.
- Same rules as the other releases: tag, images, then the store build, and verify the result on real devices before promoting.

## 8. Testing before submission

- Real devices: one low-end Android, one recent Android, one iPhone, one tablet.
- Airplane-mode test: take orders, kill the app, reconnect, check there are no duplicates and no lost orders.
- Rider test with a real phone outdoors: location accuracy, battery use over an hour, screen locked.
- Permission denial paths: location off, notifications off, camera off.
- Accessibility: screen reader, large text, contrast.
- Security: token in secure storage, no secrets in the bundle, certificate checks for HTTPS servers, clear text allowed only for private LAN addresses.

## 9. Risks

| Risk | What reduces it |
|---|---|
| Apple rejects as "just a website" | Native features in release 1 (push, camera, biometrics, location), a proper offline mode, review notes |
| Reviewers cannot log in | Public demo server with sample data and reviewer accounts |
| Phones pause location in the background | Foreground-only in release 1, shown clearly to riders; background tracking later as its own release |
| Push for self-hosted installs | Decide who owns the push keys (below) |
| Two stores means two review cycles | Submit Android first, iOS right after; fix shared issues once |
| Offline conflicts | Money actions online only, server wins, refused actions shown to the user |

## 10. Decisions needed from the owner

1. Which app first: the **staff and rider app** (recommended) or the **customer app** for PKUSS.
2. Push notifications: one NodeDR push relay that all installs use (simple for owners, NODEDR runs it) or each restaurant brings its own FCM and APNs keys (no shared service, harder to set up). Recommended: relay.
3. Developer accounts: confirm NODEDR INFOTECH PRIVATE LIMITED as the publisher and that a D-U-N-S number exists or can be requested.
4. A Mac for iOS builds, or a cloud Mac service.
5. Background location for riders in release 1 (slower approval) or later (recommended).
6. Public demo server: where it runs and who resets it.

## 11. First two weeks

1. Spike on a real Android phone and iPhone (Phase 0).
2. Create the Play and Apple organization accounts now, because identity checks can take days.
3. Stand up the demo server with sample data.
4. Write the device-token and push backend (Phase 2 backend part) while the shell is being built.
5. Draft listing text, privacy policy mobile section and the data-safety answers from section 5.

## Standalone mode (branch `standalone-mode`, not released)

The app can also run without the restaurant server being reachable. The phone has a bundled mini point of sale (`mobile/www/pos/`) that stores the menu and sales in IndexedDB and syncs with the server when it is online.

- **Start mode**: `app` (default, opens the restaurant's web app) or `standalone` (opens the bundled POS). It is set from the connect screen or from the "Can't reach the server" page ("Open the standalone point of sale").
- **Snapshot**: `GET /api/v1/mobile/standalone/snapshot?branchId=` returns menu, categories, taxes, payment modes, UPI id and restaurant details. Dishes that need required options or are combos have `sellOffline:false` and are disabled in the app.
- **Sales push**: `POST /api/v1/mobile/standalone/sales?branchId=`. Each sale has an id that becomes `Order.clientRequestId` and `Payment.clientRequestId`, so a retry never creates a second order. Results are `created`, `duplicate` or `refused` (with a reason).
- **Offline policy**: cash, card, UPI and other payments are allowed offline and saved as "waiting to sync". The server accepts them as final and records them at the prices charged on the phone. No kitchen ticket is made and no table is occupied for synced sales.
- **Refusals**: a sale the server cannot take (for example a dish removed or a payment short of the total) is cancelled on the server and shown as "Needs attention" on the phone.
- **Quiet errors**: the Android shell retries a failed page load three times before showing the error page, and ignores HTTP error statuses, so changing tabs no longer shows "Can't reach the server".

### On-this-phone account (1.19.0)

Standalone mode no longer needs a server first. "Create an account on this phone" (`pos/lib/local.js`) stores the account (PBKDF2-SHA256 password hash), the restaurant and an editable menu in IndexedDB. Sales are taken as usual and stay pending. "Connect to a server" (Sync tab) signs in, downloads the server menu, matches waiting sales to server dishes by name (a sale with a dish the server lacks is marked refused and kept) and sends the rest. Local data is never sent anywhere until a server is connected.
Password handling (1.19.2): change it from the Sync tab (current password required). A forgotten password cannot be recovered; "Forgot my password" erases the phone account, its menu and its sales after typing ERASE.
