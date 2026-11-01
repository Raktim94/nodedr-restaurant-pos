# Engineering checklist

Status: **Verified** = run and observed · **Tested** = automated tests pass ·
**Implemented** = code written, not run end to end · **Existing** = predates this
checklist, inspected by reading code only · **Open** = not done · **Blocked** = needs access.

Last updated 2026-11-01. Baseline: backend typecheck clean, 262 unit tests pass, 99 e2e tests (11 suites) pass against Postgres 16 (scratch cluster), web typecheck + production build clean.

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
| Webhooks (HMAC, SSRF guard), API keys/scopes | Existing | Retry/backoff, replay protection, delivery history not re-audited |
| Zomato / Swiggy adapters | Open + Blocked | Needs partner API access and merchant credentials; none exist in this repo |
| Order lifecycle NEW..COMPLETED, PREPARING/READY | Open | Status enum is OPEN/BILLED/PAID/CANCELLED plus acceptance gate; KDS tracks kitchen state separately |
| Dashboard KPI click-through | Verified | 10/10 cards/rows link to the right view in a browser; `/orders?tab=&filter=` deep links work. Chart axis clipping fixed |
| Dashboard: pending payments, low stock, customers, team, draft payroll cards | Verified | DB-backed, role-gated on the server (cashier gets null for staff/inventory fields; e2e + browser). Deep links to /inventory?filter=low and /team?tab=payroll |
| Dashboard widget show/hide/reorder, date ranges, role presets | Open | |
| Cashier 403 on GET /settings (shell brand + checkout UPI QR silently missing) | Fixed + verified | New allow-listed GET /settings/display; cashier now sees the UPI QR in a browser |
| Payroll calc | Tested (unit) | `payroll.calc.spec.ts`; attendance has no tests |
| Cash register open/close reconciliation | Open | `Shift` model exists, not audited |
| Browser verification of every screen | Partial | Dashboard, POS, Orders, Customer detail driven in Chrome via Playwright; the other screens not yet |
