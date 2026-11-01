# Engineering checklist

Status: **Verified** = run and observed · **Tested** = automated tests pass ·
**Implemented** = code written, not run end to end · **Existing** = predates this
checklist, inspected by reading code only · **Open** = not done · **Blocked** = needs access.

Last updated 2026-11-01. Baseline: backend typecheck clean, 262 unit tests pass, 162 e2e tests (16 suites) pass against Postgres 16 (scratch cluster), web typecheck + production build clean.

| Area | Status | Notes |
|---|---|---|
| Partial / split payment, change, idempotent checkout | Tested | `settlement.spec.ts` incl. the 350/300/400 and 500-50 scenarios |
| Discount cap + reason + cash (₹) discount with presets at checkout | Verified | Unit + e2e + browser as a cashier: over-cap ₹100 on ₹220 blocked with message; ₹10 preset paid, DB shows FIXED 10, reason stored. Migrations applied on a scratch Postgres 16, not on any live install |
| AGPL notices (NOTICE, COPYRIGHT, TRADEMARK_POLICY, SECURITY) | Implemented | Ownership and trademark registration unverified; 3 deps lack a licence field |
| AGPL s13 source link in Settings | Implemented | Not seen in a browser |
| Product image delivery: optimized WebP thumbnails, 1-year cache, restricted to upload + app static paths | Verified (menu page); kiosk cards not browser-tested | Realistic 660 KB photo served as 760 B (48px) / 1.9 KB (96px) / 7.5 KB (384px). Regression caught and fixed during verification: configuring `localPatterns` had blocked `/logo.png`; now an explicit allow-list (traversal / API / external URLs return 400). Uploads themselves are still stored at full size |
| **Bulk CSV import: menu items + ingredients** (docs/IMPORT.md, example files in docs/examples/) | Verified | Preview-then-commit, idempotent re-import, blank cells never erase, opening stock via the stock ledger only for ingredients with no history, all-or-nothing with opt-in skip, per-row errors with line numbers + downloadable problem list, Excel encodings/delimiters, formula-injection and unquoted-comma protection, 2 MB / 2000-row limits, permissions + tenant isolation, audit. 29 unit + 23 e2e tests (stock-doubling guard mutation-checked); browser: example download -> upload -> import, broken file, mobile 360px, cashier blocked. Shipped example files are tested to import with zero errors |
| Menu grid text overflow, lazy images | Verified | Browser check with a 100-char unbroken name at 360/768/1440px: no page overflow, card inside grid, label clamped |
| Edit open bill, refunds, cancel with reason | Existing | |
| Edit paid bill via adjustment entries | Open | Today: refund only |
| Per-item discounts | Open | |
| Multiple customer addresses | Verified | Model + migration (applied on Postgres 16, old address carried over), API, 6 e2e tests incl. tenant isolation, UI add/edit/default/delete and POS phone-based picker driven in a real browser |
| **Security: open sign-up on a configured server** | Fixed + verified | `POST /auth/register` let any stranger create an OWNER (instance-wide backup/update/sync perms). Now closed after first run; `ALLOW_PUBLIC_SIGNUP=true` opts in. 4 e2e tests + proven on a fresh DB (1st owner 201, stranger 403) |
| Security: cross-tenant sweep of every GET route | Verified | 134 GET routes replayed as a foreign-restaurant user (80 branch-scoped, 19 id-templated): no data leaks. Instance-level endpoints (backup/sync/update) are only reachable by perm holders - see sign-up fix |
| Security: dependencies | Improved | `pnpm audit --prod` 19 findings (7 high) -> 3 moderate (transitive glob/minimatch via archiver, @hono via MCP SDK). node-forge ->1.4.2; shadcn CLI moved to devDependencies |
| Security: web response headers | Fixed + verified | nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, HSTS; X-Powered-By removed. CSP for web pages still open (needs nonce middleware) |
| Webhooks (HMAC, SSRF guard), API keys/scopes | Existing | Retry/backoff, replay protection, delivery history not re-audited |
| Integrations hub (Settings -> Integrations): adapter interface + registry, encrypted credentials, status, enable/disable, test, activity log | Verified | 11 e2e + 6 unit tests, mutation-checked (plaintext storage is caught); browser: secret never in page/log/reopened form, status honest. Docs: docs/INTEGRATIONS.md. Migration 20261101210000 applied on scratch Postgres |
| Referral rewards (share a dish / link, points, redeem) | Verified | Settings: enable, sharer/new-customer points, point value; paid once when the first purchase is PAID (atomic claim + ledger idempotency keys); no self-referral / duplicates / early payout; 15 e2e tests incl. 5-way race; proxy -> API -> payout verified end to end. Docs: docs/REFERRALS.md. Migration 20261102000000 (additive) |
| Delivery riders: sign in with phone + password, My deliveries (duty, live location, own deliveries only, statuses, failed reason), staff rider panel | Verified | 7 e2e incl. upgrade path (permission granted once to existing DELIVERY_STAFF roles); another rider's order is a 404. Browser location needs the page open. Docs: docs/RIDER.md. Migration 20261102180000 |
| Website price change (cheaper/costlier, % or amount) + customer shared location | Verified | 9 e2e: menu and order priced identically, staff/POS orders untouched, never below 0, min order on adjusted price, position/landmark saved and returned. Migration 20261102210000 |
| Zomato / Swiggy / aggregator order intake (signed webhook) | Verified | Settings -> Integrations: per-provider webhook URL, secret generator, HMAC + timestamp window, idempotent by platform order id, cancel, honest Connected status; 11 e2e tests (test/aggregator-webhook.e2e-spec.ts). Docs: docs/INTEGRATIONS.md. **Not built:** sending accept/reject/ready back to Zomato/Swiggy (needs their outbound API + sandbox) |
| Payment gateway / accounting / marketing / messaging connectors | Not implemented | Not listed in the UI |
| Incoming webhook receiver for platform pushes, menu-item mapping for imported orders | Open | Depends on a real adapter |
| Order lifecycle NEW..COMPLETED, PREPARING/READY | Open | Status enum is OPEN/BILLED/PAID/CANCELLED plus acceptance gate; KDS tracks kitchen state separately |
| Dashboard KPI click-through | Verified | 10/10 cards/rows link to the right view in a browser; `/orders?tab=&filter=` deep links work. Chart axis clipping fixed |
| Dashboard: pending payments, low stock, customers, team, draft payroll cards | Verified | DB-backed, role-gated on the server (cashier gets null for staff/inventory fields; e2e + browser). Deep links to /inventory?filter=low and /team?tab=payroll |
| Dashboard customisation: show/hide, reorder, chart period (7/14/30/90 days), restore default, saved per user | Verified | Server-side whitelist (unit + 6 e2e); browser: reorder confirmed by on-screen position, persisted across a fresh login, another user unaffected. Not done: role-specific default layouts |
| Cashier 403 on GET /settings (shell brand + checkout UPI QR silently missing) | Fixed + verified | New allow-listed GET /settings/display; cashier now sees the UPI QR in a browser |
| Payroll: adjustments (allowances, bonus, advance, deductions), PAID state, pay-once guard, salary slip, duplicate-run lock | Verified | 10 e2e tests (incl. concurrent create/pay races, mutation-checked), unit tests for the maths, and a browser run: adjust -> finalize -> pay -> printable slip, DB confirmed. Migration 20261101180000 applied on scratch Postgres |
| Payroll: statutory deductions (PF/ESI/TDS), overtime, daily wages, attendance corrections log, CSV/PDF export | Open | Amounts are manual adjustments only; rules must be configurable per restaurant, none hardcoded |
| Attendance: validated clock in/out, race-proof clock-in, audited manager corrections (reason, before/after), blocked inside finalized payroll | Verified (API) | 9 e2e tests; race and payroll-lock tests are mutation-checked (fail without the fix). Correction UI not built yet - API only |
| App-wide: error messages were invisible (`toast.*` with no Toaster mounted; 147 error calls in 61 files) | Fixed + verified | `lib/toast.ts`: errors show, success/info/warning stay silent as before (the 1.3.0 decision). Browser: a rejected webhook URL now shows its message. To restore success popups, make `success` call sonner |
| Cash register open/close reconciliation | Open | `Shift` model exists, not audited |
| Browser verification of every screen | Partial | Dashboard, POS, Orders, Customer detail driven in Chrome via Playwright; the other screens not yet |
