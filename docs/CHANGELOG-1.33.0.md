# 1.33.0

* **Stock journal voucher:** a Tally-style manufacturing entry with **Source / Consumption** and **Destination / Production** side by side (stacked on phones). Several ingredients and several finished products in one voucher; available stock, quantity, unit, rate and amount per row; "Fill from recipe" shows the expected quantity beside the actual; additional production costs; quality result and grade; narration. The review step shows server-calculated cost and cost per unit and blocks posting when stock is short. The menu selling price is never changed by the voucher. Opened from **Inventory > Production** and from the new **Manufacturing** card under the menu on the POS screen.
* **POS Manufacturing card** is now always shown to anyone who may record production (it used to be hidden when costing was switched off).
* **Stock report** (**Inventory > Stock report**, CSV export): opening, purchases/receipts, manufacturing used, manufacturing produced, sales, waste, adjustments and closing per item and location for a date range, summed from the stock ledger.
* **Windows:** MSIX 1.0.11.0 (first-run welcome screen, installer checks disk space and installs WebView2).
* No database migrations. Upgrade notes: costed vouchers need exactly one finished product; with several products only quantities are recorded.
