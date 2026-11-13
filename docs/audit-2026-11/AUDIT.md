# OrderRestro audit, 2026-11-13

Checked against a local scratch Postgres (never production). "Verified" means exercised through UI or API against the
database; "read" means only read in code.

## Findings and what was done

| Area | Finding | Severity | Status |
|---|---|---|---|
| Recipe costing | Shipped in 1.26.0 on master; calculator, cost-per-portion, margin pricing, phone cost book | requested removal | **Removed** from UI, API, phone. Tables kept (see STOCK-JOURNAL.md) |
| Waste | Ingredient-only; one `WasteLog` row per batch; fixed 6 reasons; showed a money total from batch cost; no shift, no approval, no reversal, no way to say "already in production" | high | **Replaced** by waste entries (verified: stock moves once, reversal restores once) |
| Stock math | `consumeStock` used JS floats with `round3` | medium | **Fixed**: exact decimals; existing inventory/order e2e still pass |
| Production | None in the product (the 1.26 "preparation run" was recipe based) | requested | **Built** (verified, 16 e2e checks) |
| Payroll | Overlapping/duplicate attendance rows were summed, double-paying | high | **Fixed**, tested |
| Payroll | MONTHLY pay used the first month's length for the whole period; a period across two months was mispriced | high | **Fixed** (per calendar month), tested incl. leap February |
| Payroll | A clock-in with no clock-out was silently dropped | medium | **Warns** on the new run; hours not guessed |
| Payroll | A person on a run could finalize and pay their own pay | medium | **Blocked** unless they hold `roles.manage` (owner/admin) |
| Payroll | A finalized run could not be corrected | medium | **Reopen** while unpaid; paid runs cannot be reopened (correct in next run) |
| Payroll | No CSV export | low | **Added** |
| Tables | Delete of a table with an open order or booking was not guarded | high | **Fixed**, single and bulk (all-or-nothing) |
| Tables | Bulk create had no preview, prefix, size or grid control; no bulk edit/delete; 3 shapes | medium | **Added**; 6 shapes |
| Phone, small screens | New dialogs squashed item pickers and filters | medium | **Fixed**, checked at 375px |

## Update (same day, 1.27.0): what was finished afterwards

Done and verified: payroll unpaid breaks, daily overtime rule and a formula on the payslip; saved floor layouts per area;
enrolled-phone list with revoke/restore enforced on every request; phone Kitchen tab (production and waste recorded
offline, kept through a restart, sent once with an idempotency key, refusals kept with the server's words and a Try again).

## Still not done

* Payroll: late/absence rules (not defined by the restaurant), statutory/tax rules (deliberately not invented), offline attendance.
* Phone: offline attendance and stock receipts; a conflict screen beyond "refused, try again"; sync over the local network with no internet; per-device credentials (a phone shares its user's session, revocation is by device id).
* Floor plan: drag/resize/rotate, undo/redo, snap and zoom on touch screens were not audited; merge/split was not re-tested.
* Waste photos, multiple stock locations and transfers between them.
* Screens other than Inventory, Tables, Team/payroll and Settings > Phones were not inspected in a browser; no Android device test.

## Tests run

* Backend unit: 385 passed. Backend e2e (real Postgres): 135 passed across inventory, journal, permissions, payroll,
  payroll controls, order flow, tables, discounts, dashboard, attendance, lifecycle, branches, kiosk.
  13 other e2e suites were not run (flags not set).
* Web: `tsc --noEmit` and `eslint` clean; `next build` succeeds.
* Phone library tests: 42 passed.
* Screenshots: `docs/audit-2026-11/`.

## Deployment

Released as v1.27.0 and deployed on 2026-11-13 to PKUSS, 192.168.1.40 and the Play review demo. Four additive migrations
(no DROP) applied on each. Play: signed bundle versionCode 127000 submitted to closed testing (Alpha), in review.
