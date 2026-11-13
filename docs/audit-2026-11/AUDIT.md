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

## Not done (be clear about these)

* **Payroll**: no break deduction, no overtime, no late/absence rules, no statutory/tax rules (none invented), no
  versioned calculation inputs, no timezone-change test beyond the existing zoned-range use. Attendance has no break
  field. Payslips show amounts but not a formula breakdown.
* **Floor plan**: *several saved layouts per area* (lunch/dinner) is **not built** (needs a schema change). Areas are
  the existing floors with create and rename; no ordering, active flag or opening hours. Merge exists from before and
  was not re-tested. Drag/resize on touch, undo/redo, snap and zoom were not audited or changed.
* **Mobile offline**: the existing Capacitor app already keeps sales, tabs, KOTs, refunds, expenses and bookings in
  IndexedDB and uploads sales idempotently (server answers `duplicate` for a repeat). **Not built**: offline
  production, waste, stock and attendance on the phone; device enrolment and revocation; a conflict queue beyond
  "refused sale"; local-network sync; offline-payment rules beyond cash. The new production and waste endpoints already
  accept `idempotencyKey` and `deviceId`, so the phone can send them once a screen exists.
* **Sync design, devices admin screen, per-device credentials**: not built.
* **Screen-by-screen audit**: only Inventory (stock items, journal, production, waste) and Tables were inspected in a
  browser (375, 768, 1440). Other screens were not.
* **Photos on waste, transfers between locations, multiple stock locations**: not built. "Location" is a free-text
  label on production and waste.
* No real Android device test. No APK was built from this branch.

## Tests run

* Backend unit: 385 passed. Backend e2e (real Postgres): 135 passed across inventory, journal, permissions, payroll,
  payroll controls, order flow, tables, discounts, dashboard, attendance, lifecycle, branches, kiosk.
  13 other e2e suites were not run (flags not set).
* Web: `tsc --noEmit` and `eslint` clean; `next build` succeeds.
* Phone library tests: 42 passed.
* Screenshots: `docs/audit-2026-11/`.

## Deployment

Nothing was deployed, published or released. The migration `stock_journal_production` is additive (no DROP) and has
only been applied to a scratch database.
