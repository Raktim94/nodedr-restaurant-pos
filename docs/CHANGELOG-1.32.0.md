# 1.32.0

* **Security audit fixes (9 findings, all verified):** staff can no longer grant or edit roles/accounts above their own permissions; server-wide operations (backup, update, sync settings) need an instance operator; webhook/buzzer targets refuse private and IPv6-mapped addresses; table-pay routes need a table grant; wrong-code lockout per source; offline-sale discounts and old-sale dates are bounded; refunds must be above zero; restore archives and updater downgrades are refused when unsafe. Changing a password signs out that account's other sessions.
* **Secure NFC table ordering (NTAG 424 DNA):** per-tag sealed keys, CMAC-verified taps, replay-proof counter, staff test tap binds the chip, rotate/disable/replace, tap log. A tap only proves presence; the first valid order opens the table session. New admin page **Ordering mode & NFC tags** and permission `nfc.manage`. Off by default (`nfcTablesEnabled`).
* **Table lifecycle + live board:** derived states CLOSED / ACCESS_VERIFIED / OPEN / ORDER_PROCESSING / PAYMENT_PENDING / SETTLED / ATTENTION_REQUIRED, `GET /tables/overview`, Live tables page. A table with an unpaid order never auto-closes. Optional `autoTableSessions` (off by default).
* **Menu item options:** create and edit sizes and extras (groups and options with prices, defaults) on each item. Editing a group that old orders used now works (used options are hidden, not deleted).
* **Orders:** order numbers no longer collide when many orders arrive at once.
* **Phone POS:** the discount needs a reason when the restaurant requires one; the reason is sent with the sale and stored.
* **Stock journal:** quality inspection on production, `production.quality` permission, price snapshot on posting, richer reports.
* **Windows:** MSIX 1.0.10.0.
* Migrations (all additive): session_revocation, batch_quality_and_price_snapshot, secure_nfc_tables_and_auto_sessions, modifier_is_active.
* Upgrade notes: `requireTableSession` stays as it was. Phone POS still cannot sell items that have options (it says "use the full app").
