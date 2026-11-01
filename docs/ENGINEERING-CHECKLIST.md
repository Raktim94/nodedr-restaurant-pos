# Engineering checklist

Status: **Verified** = run and observed · **Tested** = automated tests pass ·
**Implemented** = code written, not run end to end · **Existing** = predates this
checklist, inspected by reading code only · **Open** = not done · **Blocked** = needs access.

Last updated 2026-11-01. Baseline: backend typecheck clean, 262 unit tests pass, 113 e2e tests (13 suites) pass against Postgres 16 (scratch cluster), web typecheck + production build clean.

| Area | Status | Notes |
|---|---|---|
| Partial / split payment, change, idempotent checkout | Tested | `settlement.spec.ts` incl. the 350/300/400 and 500-50 scenarios |
| Discount cap + reason + cash (₹) discount with presets at checkout | Verified | Unit + e2e + browser as a cashier: over-cap ₹100 on ₹220 blocked with message; ₹10 preset paid, DB shows FIXED 10, reason stored. Migrations applied on a scratch Postgres 16, not on any live install |
| AGPL notices (NOTICE, COPYRIGHT, TRADEMARK_POLICY, SECURITY) | Implemented | Ownership and trademark registration unverified; 3 deps lack a licence field |
| AGPL s13 source link in Settings | Implemented | Not seen in a browser |
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
| Zomato / Swiggy adapters | Open + Blocked | Needs partner API access and merchant credentials; none exist in this repo |
| Order lifecycle NEW..COMPLETED, PREPARING/READY | Open | Status enum is OPEN/BILLED/PAID/CANCELLED plus acceptance gate; KDS tracks kitchen state separately |
| Dashboard KPI click-through | Verified | 10/10 cards/rows link to the right view in a browser; `/orders?tab=&filter=` deep links work. Chart axis clipping fixed |
| Dashboard: pending payments, low stock, customers, team, draft payroll cards | Verified | DB-backed, role-gated on the server (cashier gets null for staff/inventory fields; e2e + browser). Deep links to /inventory?filter=low and /team?tab=payroll |
| Dashboard widget show/hide/reorder, date ranges, role presets | Open | |
| Cashier 403 on GET /settings (shell brand + checkout UPI QR silently missing) | Fixed + verified | New allow-listed GET /settings/display; cashier now sees the UPI QR in a browser |
| Payroll: adjustments (allowances, bonus, advance, deductions), PAID state, pay-once guard, salary slip, duplicate-run lock | Verified | 10 e2e tests (incl. concurrent create/pay races, mutation-checked), unit tests for the maths, and a browser run: adjust -> finalize -> pay -> printable slip, DB confirmed. Migration 20261101180000 applied on scratch Postgres |
| Payroll: statutory deductions (PF/ESI/TDS), overtime, daily wages, attendance corrections log, CSV/PDF export | Open | Amounts are manual adjustments only; rules must be configurable per restaurant, none hardcoded |
| Attendance module | Open | Still no tests; only exercised indirectly via payroll hours |
| **App-wide: `toast.*` renders nothing (Toaster removed in 1.3.0)** | **Open - decision needed** | 65 files still call sonner `toast`, so their success/error messages are invisible. New code uses inline `StatusNote`. Remount an errors-only Toaster, or convert the 65 files |
| Cash register open/close reconciliation | Open | `Shift` model exists, not audited |
| Browser verification of every screen | Partial | Dashboard, POS, Orders, Customer detail driven in Chrome via Playwright; the other screens not yet |
