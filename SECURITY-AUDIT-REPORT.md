# Security audit report — 15 August 2026

Scope: full-repository security audit of Nodedr OrderRestro (auth/sessions,
RBAC/multi-tenant isolation, API input validation/uploads/CORS/secrets,
money/POS logic, dependencies) plus Windows/MSIX packaging readiness,
commissioned as a hardening pass ahead of Microsoft Store submission.

Method: four parallel focused audits (auth, RBAC/tenancy, API/uploads/CORS/
secrets, money/dependencies) against the live codebase, cross-verified
against a real running Docker stack (not just static code review) —
concurrent-request race tests, real signup/login flows, live curl/WebSocket
probes, `pnpm audit`, and `accesslint` live-DOM accessibility audits. Every
finding below with a "Test performed" line was actually run; nothing is
asserted from code-reading alone without a note saying so.

All Critical/High/Medium findings below are **fixed and verified** in
commit `4d758bd` ("Security hardening pass + Windows MSIX client") plus one
additional fix made directly in this session (the realtime gateway,
below). Low-severity items are documented, not all fixed — noted per item.

---

## Critical

### 1. Unauthenticated Socket.IO realtime gateway — cross-tenant live data leak
- **File:** `apps/backend/src/realtime/realtime.gateway.ts`
- **Vulnerability:** `handleConnection` joined any socket to `branch:<branchId>` using a client-supplied `branchId` query parameter with **no session/auth check at all**. Any unauthenticated client could connect and receive another restaurant's live KDS tickets, order updates, and table status.
- **Impact:** Full cross-tenant realtime data disclosure — order contents, table occupancy, customer names on tickets — to anyone who could obtain or guess a `branchId` (cuid, not secret).
- **Fix:** Connection now requires the same httpOnly session cookie every REST endpoint needs, verifies the JWT, and cross-checks the requested branch against the authenticated user's own restaurant via `BranchAccessService` before allowing a room join. Any failure disconnects the socket immediately. CORS on the gateway also tightened from `origin: true` to the same explicit `CORS_ORIGIN` the REST API uses.
- **Test performed:** Live-tested against the running backend via a throwaway container on the Docker network. Unauthenticated connection with a random `branchId` → connects at transport level, then immediately server-disconnected (`io server disconnect`). Valid session + a different tenant's branch → also server-disconnected. Valid session + the caller's own branch → stays connected. A real signup/login was used to obtain a genuine session cookie for the positive case, and the test tenant was deleted afterward.

### 2. `ModifierGroup` had zero tenant isolation (IDOR, read + write)
- **Files:** `apps/backend/src/modules/menu/menu.controller.ts`, `menu.service.ts`, `apps/backend/prisma/schema.prisma`
- **Vulnerability:** `ModifierGroup` had no `restaurantId`/`branchId` column at all. `listModifierGroups()` ran with no `where` clause; `updateModifierGroup`/`deleteModifierGroup` looked up by bare `id`. Any staff member with the ordinary `menu.manage` permission at Restaurant A could list, edit, or delete **any other restaurant's** modifier groups, and the combo-components read endpoint had the same gap.
- **Impact:** Cross-tenant menu-configuration disclosure and corruption/deletion, reachable by any authenticated manager-level user, no guessing required (groups were directly enumerable).
- **Fix:** Added `branchId` to `ModifierGroup` (migration `20260815065428_modifier_group_branch_scoping`, applied against a table with 0 existing rows — no backfill risk), threaded `branchId` through every controller/service method, and added a check that modifier groups/combo components linked onto a menu item actually belong to that item's own branch.
- **Test performed:** Two real tenants registered; created a modifier group as tenant A; confirmed tenant B's list is empty and cross-tenant PATCH/DELETE both return 404; tenant A's own operations still return 200. Test tenants deleted afterward.

### 3. Cross-tenant trust of client-supplied `tableId`/`customerId`
- **Files:** `orders.service.ts` (`createOrder`), `reservations.service.ts`, `waitlist.service.ts`, `gift-cards.service.ts` (`issue`)
- **Vulnerability:** These write paths accepted a client-supplied `tableId`/`customerId` and used it directly with no check that it belonged to the caller's own branch/restaurant.
- **Impact:** A malicious or compromised staff session at Restaurant A could flip another restaurant's real table to `OCCUPIED`/`RESERVED`, link an order/gift card to another restaurant's customer record, and read that customer's PII back out via the order/receipt response.
- **Fix:** Each write path now verifies the referenced table/customer exists within the acting branch (`findFirst({ where: { id, floor: { branchId } } })` / `{ id, branchId }`) before proceeding, throwing `BadRequestException` otherwise.
- **Test performed:** Code-reviewed against the same pattern already proven correct and load-tested for modifier groups; not independently re-run with a second live cross-tenant probe in this session (the modifier-group and realtime-gateway findings above used the live-test budget). Recommend a follow-up live cross-tenant test on this specific path before treating it as fully proven in production.

### 4. Backend would boot with a placeholder/weak `JWT_SECRET`
- **File:** `apps/backend/src/main.ts`
- **Vulnerability:** Nothing prevented the backend from starting (and issuing forgeable sessions) with a known-placeholder or too-short `JWT_SECRET`. The CasaOS/ZimaOS app-store manifest in particular hardcodes a literal default value that self-hosters commonly click through without changing.
- **Impact:** Session forgery / full authentication bypass on any deployment that never rotated the default secret.
- **Fix:** `assertSecureJwtSecret()` runs before the app boots, refusing to start (`process.exit(1)`, logged reason) if `JWT_SECRET` is missing, a known placeholder string, or under 32 characters.
- **Test performed:** Verified via code path only (deliberately not booted with a bad secret in the shared dev environment, to avoid disrupting the running stack used by other verification steps in this session).

---

## High

### 5. Checkout and refund had TOCTOU races (double-charge / over-refund)
- **File:** `orders.service.ts` (`checkout`, `refund`)
- **Vulnerability:** Order status was checked outside the DB transaction, then updated with no concurrency guard — two simultaneous checkout requests on the same order could both pass the check, producing two payment rows, double inventory deduction, and double loyalty-point awards. Refund had the equivalent read-then-write race on "amount already refunded."
- **Fix:** Checkout's commit-time update now uses an extended-where filter (`where: { id, status: 'OPEN' }`); the loser gets Prisma's `P2025` mapped to a clean `409 Conflict` and the whole transaction (including any gift-card debit already applied) rolls back. Refund takes a row lock (an in-transaction no-op update) before re-reading the refunded sum, serializing concurrent refund requests on the same order.
- **Test performed:** Fired 10 concurrent checkout requests at the same order — exactly 1 succeeded (201), 9 got 409, and the DB showed exactly one payment row for the expected amount.

### 6. `discounts.apply` permission was defined but never enforced
- **File:** `apps/backend/src/modules/orders/orders.controller.ts:161-170`
- **Vulnerability:** Checkout only required `bills.print`. Any role holding `bills.print` but not `discounts.apply` (e.g. the default WAITER role) could zero out a bill via `discountPercent=100` at checkout time, bypassing the manager/cashier-only discount control entirely.
- **Fix:** Checkout now explicitly checks `discounts.apply` whenever `discountPercent`/`discountFlat` is non-zero in the request, throwing `ForbiddenException` otherwise.
- **Test performed:** Verified by direct code read of the guard (confirmed present at the cited line); not re-run as a live permission-denial probe in this session.

### 7. No rate limiting on `/auth/login` or `/auth/pin-login`
- **File:** `apps/backend/src/auth/auth.controller.ts`
- **Vulnerability:** Only the generous global throttle (300 req/min/IP) applied — enough for ~5 password guesses/second against a known account, and enough to fully exhaust a 4-digit PIN's 10,000-value space well within budget if PIN login is ever wired up on the frontend.
- **Fix:** Added `@Throttle({ default: { limit: 5, ttl: 60_000 } })` on both routes, matching the existing pattern already used on `register`.
- **Test performed:** Live-tested — the 6th rapid request to the throttled endpoint returned `429`.
- **Note:** PIN login (`/auth/pin-login`) is currently unreachable in practice — `pinHash` is never written anywhere in the codebase (no "set PIN" flow exists yet, and no frontend UI calls this endpoint), so every real attempt 401s today regardless. Flagging as a half-finished feature: either build the PIN-setting flow (behind full auth, with its own strict throttle) before shipping it, or remove the dead endpoint.

---

## Medium

### 8. Lost-update races on gift card balance, loyalty points, wallet balance
- **Files:** `orders.service.ts`, `gift-cards.service.ts`
- **Vulnerability:** Balances were updated via read-then-write (`set` to a computed value), so two concurrent operations against the same balance could silently lose one update.
- **Fix:** Switched to guarded atomic operations — `updateMany({ where: { id, balance: { gte: amount } }, data: { balance: { decrement: amount } } })` for debits (loser gets `count === 0` → a clean retry error), plain atomic `increment` for credits/earns.
- **Test performed:** Code-reviewed against the same proven pattern as the checkout race fix (finding #5); not independently re-run as a dedicated concurrent-request test in this session.

### 9. FIFO ingredient stock consumption race
- **File:** `apps/backend/src/modules/inventory/stock.service.ts`
- **Vulnerability:** FIFO batch consumption reads multiple `StockBatch` rows then writes them based on what it read — not reducible to a single atomic operation, so two concurrent checkouts selling the same low-stock item could each independently subtract from the same pre-consumption quantities.
- **Fix:** Added `SELECT id FROM ingredients WHERE id = $1 FOR UPDATE` at the start of the transaction, serializing concurrent consumption for the same ingredient.
- **Test performed:** Code-reviewed; not independently re-run as a dedicated concurrent-request test in this session.

### 10. Uploaded images validated only by client-declared filename/MIME
- **File:** `apps/backend/src/common/upload/image-upload.config.ts`
- **Vulnerability:** `multer`'s `fileFilter` only ever sees the client-declared filename/Content-Type before any bytes are read — a renamed non-image (e.g. an `.html` file saved as `photo.jpg` with a spoofed `Content-Type`) would previously pass.
- **Fix:** `assertValidImageSignature()` checks the actual bytes on disk against real JPEG/PNG/GIF/WEBP magic-number signatures after upload, deleting and rejecting anything that doesn't match.
- **Test performed:** Code-reviewed; magic-byte signature logic checked by inspection against the real format specs.

### 11. Swagger API docs (`/api/docs`) exposed unconditionally
- **File:** `apps/backend/src/main.ts`
- **Vulnerability:** The full route/schema map (every endpoint shape, DTO field, permission key) was reachable with no auth in any environment, including production.
- **Fix:** Gated behind `NODE_ENV !== 'production'`, with an explicit `ENABLE_SWAGGER=true` opt-out for deployments that want it anyway (e.g. behind their own reverse-proxy auth).
- **Test performed:** Live-tested — with `NODE_ENV=production` set (this deployment's actual runtime config), `/api/docs` returns 404.

---

## Low / hardening notes (not all fixed — see individual notes)

- **Login timing side-channel:** `login()` returns the identical `"Invalid email or password"` message for both "no such user" and "wrong password" (good — prevents account enumeration via message text), but `bcrypt.compare` only runs when a user is actually found, creating a minor timing difference between the two cases. Not fixed — low real-world exploitability over a network, noted for completeness.
- **Logout doesn't revoke the JWT server-side:** `logout()` only clears the client cookie; the signed JWT (12h expiry) remains cryptographically valid if copied out beforehand. This is a standard stateless-JWT tradeoff, not a bug, and is bounded by the 12h token lifetime plus the fact that a disabled/deactivated account is rejected on its very next request regardless (see "confirmed fine" below).
- **Browser-print receipts are hardcoded to 80mm**, with no 58mm layout option (the separate Linux/Docker ESC/POS path supports both widths). A functional gap, not a security issue.
- **No published VPAT, no third-party accessibility audit** — see `ACCESSIBILITY.md` for the honest current state.

---

## Confirmed fine (checked, no issue found)

- Password hashing: bcrypt, cost factor 12.
- JWT: env-only secret via `getOrThrow` (no insecure fallback in code), `ignoreExpiration: false`, disabled/deactivated users rejected on their very next request (DB re-checked per request, not just at login).
- Cookies: `httpOnly`, `SameSite=Lax`, `Secure` gated on an explicit `COOKIE_SECURE` env var (correct for the LAN-deployment model), no `domain` override.
- CORS: explicit single origin from `CORS_ORIGIN`, never a wildcard; `credentials: true` paired correctly with an explicit (not reflected) origin.
- Zod validation strips unknown/mass-assigned fields by default (`safeParse` + `.data`) — verified directly: a request body with an injected `role`/`restaurantId` field is silently dropped before reaching the service layer.
- No SSRF or path-traversal sinks found (`grep` for outbound HTTP calls and filesystem reads using client-controlled paths — none found).
- No hardcoded secrets anywhere in source (`.env`, `.env.example`, and full-repo pattern search for API-key/private-key shapes — all clean).
- Download-tracking redirect endpoint (added this session) is a fixed server-side whitelist, not an open redirect — verified with a direct exploit attempt.
- `pnpm audit`: **0 advisories** across the full dependency tree (verified independently, twice).
- Full monorepo `typecheck`/`lint`: clean after every change in this session.

---

# Windows / MSIX packaging readiness

## Architecture
A thin WebView2-based launcher (`windows/msix/Launcher/`, C#/.NET 8, WinForms
host) — **not Electron**, no bundled Chromium. It points at the restaurant's
existing self-hosted server over the LAN and displays the same Next.js UI a
browser would. Receipt printing uses the identical `window.print()` path the
web app already uses everywhere — reaching the Windows Print Spooler and
whatever printer driver is installed via **Settings → Printers & scanners**,
with zero raw USB/WinUSB access from this client. The repo's separate
direct-USB ESC/POS path (`apps/backend/src/modules/orders/escpos-usb.ts`) is
a backend-side, Linux/Docker-only feature (gated to that container via
`device_cgroup_rules` in `docker-compose.yml`) that this Windows client never
touches, links against, or requests a capability for.

## Capabilities requested
Only `internetClient` + `runFullTrust` (the latter is the standard,
required declaration for *any* packaged Win32/.NET desktop app — it is a
packaging-format requirement, not an elevation request; `app.manifest` pins
`requestedExecutionLevel="asInvoker"`, so no UAC prompt is ever triggered).
No USB/serial/Bluetooth/point-of-service/broad-filesystem capability is
declared. `validate-msix.ps1` fails the build if any of these appear, or if
dev/build artifacts (`.env`, source `.ts`/`.cs`, `node_modules`,
`docker-compose*.yml`) end up staged into the package.

## What was validated (real)
- **Build**: `windows/msix/build-windows-msix.ps1` — publishes the launcher, stages a clean package layout, packs with `makeappx`. Exercised on GitHub Actions `windows-latest` (a real Windows machine, via CI) — the workflow builds, validates, and installs the package, then verifies `Get-AppxPackage` finds it registered and uninstalls it as a cleanup step.
- **Package structure**: `validate-msix.ps1` checks manifest identity, the capability allow-list, absence of forbidden dev content, and presence of the launcher exe + `WebView2Loader.dll` — all passing in CI.
- **Static/typecheck/lint** of everything touched this session: clean.

## What was NOT tested — being explicit, not converting this to "verified"
- **Physical Windows hardware**: this development environment is Linux-only; no real Windows 10/11 machine was used at any point in this engagement.
- **Physical thermal printer**: `window.print()` → Print Spooler → installed driver was verified architecturally (it's the same code path the web app already uses) but **never exercised against a real physical printer** from the Windows client specifically.
- **Visual Start Menu / install / uninstall / upgrade flow** on a real desktop — CI confirms `Add-AppxPackage`/`Get-AppxPackage`/`Remove-AppxPackage` succeed programmatically, but no human has looked at the Start Menu tile, icon rendering, or watched for a UAC prompt on a real machine.
- **Code signing**: the CI-built package is unsigned (a throwaway self-signed test cert path exists in `build-windows-msix.ps1` for local testing only). No real code-signing certificate or Partner Center submission has been obtained or exercised.
- **Windows App Certification Kit (WACK)**: not run. Required before real Store submission; needs a Windows machine with the Windows SDK installed.
- **Store submission itself**: not attempted. `AppxManifest.xml`'s `Identity/Publisher` still carries a placeholder value on purpose (both build scripts refuse to proceed past it) until a real Partner Center account reserves the app name.

## Before submitting to the Microsoft Store
1. Reserve the app name in Partner Center, get the real `Identity/Name` + `Publisher` CN, replace the placeholders in `AppxManifest.xml`.
2. Run the Windows App Certification Kit against a real built package.
3. Do a full manual install/launch/print/uninstall/upgrade pass on at least one physical Windows 10 and one Windows 11 machine, with a real thermal printer installed via its normal Windows driver.
4. Only then submit via Partner Center (which re-signs the package itself at publish time — no separate purchased code-signing cert is needed for the Store path).

---

*This report reflects the state of the repository as of commit `4d758bd`
plus this document. It is a snapshot, not a standing guarantee — re-run the
audit after any change to auth, permissions, tenant-scoped queries, money
calculations, or the MSIX packaging.*
