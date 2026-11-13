# 1.31.0

* **Manufacturing costs (Stock Journal):** costed production batches: actual ingredient quantities and cost rates, extra production costs (counted or only recorded), cost per finished unit (decimal-safe, server-computed, frozen at posting), one-transaction posting with idempotency, reversal/correction. Optional **menu selling price** change from the same screen: separate `menu.price` permission, stale-price conflict detection, price history, audit. Reports by day/item/ingredient/cost category/price changes with CSV. POS **Food Manufacturing Costs** card (only when enabled and permitted). Mobile-first 5-step flow.
* **Live table sessions:** table QR/NFC no longer authorizes orders by itself; staff open a table and give guests a 6-character code; hashed codes and grants, lockout, expiry, closed on payment or reset. Setting `requireTableSession` (default on).
* **Customer ratings:** signed order-bound token, one rating per paid order, rate-limited, sanitized; admin view (`ratings.view`).
* **Navigation:** collapsible sidebar (keyboard/touch), restaurant name always visible, "Made by NodeDR" footer.
* **Public demo mode** (`DEMO_MODE`): one-click no-password entry on the demo server only, fenced (no user/role/webhook/upload/backup changes, no outbound webhooks), banner, scripted reseed (`scripts/demo/seed-demo.mjs`) on a 3-hour schedule.
* New permissions: `production.post`, `production.report`, `menu.price`, `table.session`, `ratings.view`.
* Migration (additive): manufacturing_sessions_ratings.
* Upgrade note: `requireTableSession` is ON by default. A restaurant that wants the old open QR ordering can switch it off (API: PATCH inventory/manufacturing/settings).
