# 1.27.0

* **Stock journal and daily production** from actual quantities (no recipe, no cost). Waste entries with reasons, shifts, approval and reversal. Decimal-safe stock maths. See docs/STOCK-JOURNAL.md.
* **Removed** the 1.26 recipe-costing calculator (screens, API, phone). Its tables are kept; nothing is dropped.
* **Payroll**: duplicate attendance paid once, per-month proration, open-shift warnings, unpaid breaks, daily overtime, formula on the payslip, no approving your own pay, reopen before payment, CSV.
* **Floor**: create/edit/delete several tables, six shapes, saved layouts per area, delete guard for open orders.
* **Phones**: Kitchen tab (offline production and waste), device list with revoke/restore, heartbeat with queue counts.
* Migrations (all additive): stock_journal_production, payroll_breaks_overtime, floor_layouts, pos_devices.
