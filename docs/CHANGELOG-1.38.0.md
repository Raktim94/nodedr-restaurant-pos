# 1.38.0

* **Phone POS: sell everything the menu has.**
  * **Half portions and add-ons:** dishes with a half price or option groups open an options sheet (required groups, min/max). Each dish + portion + add-ons is its own line and reaches the server as real modifiers and portion. Only combos still need the full app.
  * **Barcodes:** type or scan a barcode/SKU in the search box and press Enter (USB and Bluetooth scanners work), or tap Scan to use the camera.
  * **Customer and pay later:** name and phone on the bill; with a phone number the rest can be left owed. Sales > Money owed lists who owes what, and Collect payment records it (part or all).
  * **Voluntary service charge:** set a % in Sync > Shop settings. The cashier ticks it only when the guest agrees (never compulsory). Not taxed; reaches the server as a tip.
  * **Staff PINs:** each person switches in with a 4-8 digit PIN, every bill records who took it, and discounts, refunds, pay later, cancelling sent dishes, closing the day and menu changes need a manager's PIN. Optional idle lock. The first PIN on a phone must be a manager's.
* **Phone books reach the server.** On a server-linked phone, refunds, expenses, money collected later and the day-end cash count are sent too (each safe to resend). Cash counts show in Accounting > Cash close > Phone tills.
* **Daily automatic backup** of the phone account to Download/OrderRestro (keeps 7).
* **Safe with older servers.** The phone asks the server what it supports. Against a server older than 1.38 it hides pay later and the service charge (an older server would drop them from the sale) and keeps refunds and expenses waiting on the phone until the server is updated, with a note on the Sync tab.
* **Fixes.** Order lines now store their portion (Half/Full). The offline price check no longer double-counts tax on unchanged lines in tax-exclusive branches. A checkbox in the cart could never be ticked. Add person keeps the typed name after a PIN error. Close the day shows money collected on owed bills as part of the payments instead of as an extra line.
* **Stock journal:** every dropdown is a searchable picker.
* **Windows app (MSIX 1.0.14.0):** about 150 MB smaller to download, updates copy only changed files, normal starts skip the database migration tool when nothing is pending, and a slow first start is waited for instead of failing with "did not become healthy in time".
