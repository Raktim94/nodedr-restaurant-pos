# 1.35.0

* **Stock journal is one screen.** The voucher (Source / Consumption beside Destination / Production, Tally-style, inline), production entries, the production report and stock movements are four views of Inventory > Stock journal. The separate Production and Mfg reports tabs are gone; their old addresses redirect.
* **Delivery riders.** A delivery shows "Unassigned" until staff give it to one rider. Reassigning needs a reason; every change is kept (who, when, from, to, why). Only active delivery riders of the branch can be chosen. Double clicks and retries never create a second assignment; the previous rider is told the delivery was moved. Rider screens refresh live.
* **Dine-in table ordering.** Opening a table now shows a rotating QR (changes every 30 s) that seated guests scan; nobody has to read out a code. Each guest gets their own limited grant; closing the table, paying, or restarting it ends every grant and old QR. The 6-character code remains as a fallback.
* Migrations `delivery_assignment_history` and `table_session_join_secret` are additive.
