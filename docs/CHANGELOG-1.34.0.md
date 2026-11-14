# 1.34.0

* **Manufacturing journal v2.** Saved recipes (BOM) with a base output and versions; "Fill from recipe" scales to the planned batch and shows expected vs actual per ingredient; the recipe actually used is frozen in the voucher.
* **Good vs rejected output.** Rejected pieces are recorded but never stocked; their cost stays with the good pieces.
* **Several finished products in one voucher** with explicit cost allocation (by good quantity or manual percent, direct-material tagging, recovered scrap/by-product value). No per-product cost is shown while the split is incomplete.
* **Per-row places and lots** for source and destination; stock levels per place move with the voucher and are restored on reversal. Stock journal page and CSV filter by place.
* **PO context**: Manufacturing on the PO list and each PO carries the PO number/supplier and the items actually received; it never receives stock again.
* **Daily production report** (per local day, filters, drill-down, CSV) and **Yield analysis** (per 100 good units, cost per good unit, reject rate, yield) — posted vouchers only.
* **POS** shows each item's latest posted production cost beside its price (report-permission only), labelled "Today's" only when it is today's.
* Voucher numbers use the restaurant's local date.
* Migration `manufacturing_journal_v2` is additive.
