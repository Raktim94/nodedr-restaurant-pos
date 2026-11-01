# Engineering checklist

Status: **Verified** = run and observed · **Tested** = automated tests pass ·
**Implemented** = code written, not run end to end · **Existing** = predates this
checklist, inspected by reading code only · **Open** = not done · **Blocked** = needs access.

Last updated 2026-11-01. Baseline: backend typecheck clean, 262 jest tests pass, web typecheck clean.

| Area | Status | Notes |
|---|---|---|
| Partial / split payment, change, idempotent checkout | Tested | `settlement.spec.ts` incl. the 350/300/400 and 500-50 scenarios |
| Discount cap + reason | Tested (unit) | Migration `20261101000000_discount_guardrails` NOT yet applied anywhere (no Docker access in session) |
| AGPL notices (NOTICE, COPYRIGHT, TRADEMARK_POLICY, SECURITY) | Implemented | Ownership and trademark registration unverified; 3 deps lack a licence field |
| AGPL s13 source link in Settings | Implemented | Not seen in a browser |
| Menu grid text overflow, lazy images | Implemented | tsc + eslint clean; not yet checked in a browser at 360/768/1440 |
| Edit open bill, refunds, cancel with reason | Existing | |
| Edit paid bill via adjustment entries | Open | Today: refund only |
| Per-item discounts | Open | |
| Multiple customer addresses | Open | Customer has one free-text address |
| Webhooks (HMAC, SSRF guard), API keys/scopes | Existing | Retry/backoff, replay protection, delivery history not re-audited |
| Zomato / Swiggy adapters | Open + Blocked | Needs partner API access and merchant credentials; none exist in this repo |
| Order lifecycle NEW..COMPLETED, PREPARING/READY | Open | Status enum is OPEN/BILLED/PAID/CANCELLED plus acceptance gate; KDS tracks kitchen state separately |
| Interactive dashboard KPIs, widget customisation | Open | |
| Payroll calc | Tested (unit) | `payroll.calc.spec.ts`; attendance has no tests |
| Cash register open/close reconciliation | Open | `Shift` model exists, not audited |
| Browser verification of every screen | Open | Needs running app + DB |
