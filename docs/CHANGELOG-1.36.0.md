# 1.36.0

* **Stock journal covers every kind of entry.** Inventory > Stock journal opens on one list of production, transfer, waste and correction entries, drafts and posted. **New stock journal** asks what happened first: stock transfer between places, production or preparation, waste or spoilage, or stock correction.
* **Review before posting.** Transfer, waste and correction have a form with searchable item pickers, then a review showing what leaves stock, what enters it, the places affected, the value at average cost (only for people who can see production costs) and any shortage. A shortage blocks posting. **Save draft** changes no stock; **Post journal** asks for confirmation.
* **Posted entries are never edited**, only reversed (reason required, reversal permission). Waste rows create real waste records, so Waste reports and approvals include them.
* **List**: search by reference or item; filter by dates, type, status and place; sort by date or reference; details with audit trail; **Export CSV** of the filtered list. The production voucher gained **Save draft** and an on-screen confirmation after saving.
* Fixes: entry numbers could collide after deleting a draft; kitchen staff saw no places on the production voucher; a console error from buttons rendered as links.
* Migration `stock_journal_entries` is additive (two new tables, one new column on stock movements).
