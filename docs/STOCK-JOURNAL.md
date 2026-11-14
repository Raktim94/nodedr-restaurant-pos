# Stock journal and daily production

Quantity tracking only. Nothing here works out what a serving costs, and no screen shows a per-unit cost.

## What it does

* **Stock items** are raw materials (`PURCHASED`) or finished products (`PREPARED`), each with one stock unit,
  an optional category, storage location, minimum stock and a list of extra units
  (`1 PACK = 25000 G`). KG/G, L/ML and PIECE/DOZEN convert on their own.
* **Stock journal** (`Inventory > Stock journal`) is the existing `StockMovement` ledger read in one place:
  receipts, production use, production output, waste, sales, adjustments, reversals. Lines are only appended.
  Filter by item, type and date; export CSV.
* **Production** (`Inventory > Production`): choose the finished product, type what was actually used and what was
  actually made, review, post. Posting is one database transaction: every deduction and the finished addition
  happen together or not at all. A posted entry is never edited; a manager reverses it (reason required) or posts a
  correction that reverses the old entry and links to it.
* **Waste** (`Inventory > Waste`): item, quantity, reason, shift. If the loss is already inside a production entry
  (the batch simply made less) tick that and stock is not touched a second time.

## Worked example

Receive 25 kg rice and 10.5 kg urad dal. Make a morning batch:

| | entered | stock after |
|---|---|---|
| Rice | 6 KG | 19 KG |
| Urad dal | 2000 G (stored as 2 KG) | 8.5 KG |
| Idli (finished) | 120 PIECE | 120 PIECE |

The journal shows three lines linked to entry `PR-20261113-001`: `-6 KG`, `-2 KG`, `+120 PIECE`. If the count was
118, a manager chooses *Correct*: the old entry is reversed (three `REVERSAL` lines), a new entry for 118 is posted,
and both point at each other.

## For the kitchen and the store room

* **Stock items** are grouped by category and can be filtered by storage area. The strip at the top shows what is
  running low, what is out, and what expires in three days.
* **Stock take** (`Inventory > Stock take`): pick an area, type what is on the shelf, save. Only counted items change;
  each difference becomes an adjustment in the journal. Tick *Blind count* to hide the system quantity while counting.
* **Shopping list**: every item at or under its minimum, with `par - in stock` to buy (par defaults to twice the
  minimum). Print it or download CSV. The same page lists stock to use first (expiring within 7 days).
* **Areas** (`Inventory > Areas`): set up the places stock is kept. Each item still has ONE total, which sales,
  production, waste and receipts move. A place records how much of that total is there; the rest shows as
  *Unassigned*. *Move stock* shifts quantity between places without changing the total. A Stock take on a place
  compares with, and replaces, what is recorded in that place. If sales have used more than was unassigned, the
  item shows *Recount* rather than guessing where the stock came from.

## Rules the code enforces

* Stock never goes below zero in these flows. There is no negative-stock override.
* Quantities are exact decimals (3 places). `0.1 kg + 0.2 kg` is `0.3 kg`. A quantity that would need more than 3
  decimals after conversion is refused, not rounded.
* A unit that cannot be converted (KG for a PIECE item) is refused.
* A retried upload with the same `idempotencyKey` returns the first result and posts nothing twice.
* A batch whose finished product has already been sold or wasted cannot be reversed; record an adjustment.
* Only finished products can be produced; an ingredient cannot be both used and produced in one entry.
* Large waste: an item can carry `wasteApprovalQty`. A cook entering more is recorded as *Needs review* (stock
  has already left, because the food is in the bin); a manager approves, or rejects, which reverses it.

## Permissions

`production.record` (chef, kitchen staff, and anyone with `inventory.manage`) records production and waste.
`production.void` (inventory managers, owners) reverses, corrects, approves or rejects. Existing restaurants get
`production.record` for chefs and kitchen staff when the server starts.

## API (all under `/api/v1/inventory`, `?branchId=`)

`GET journal`, `GET journal/export.csv`, `POST journal/receipts`, `POST journal/adjustments`,
`GET production/items`, `POST production/preview`, `POST|GET production`, `GET production/:id`,
`POST production/:id/post|void|correct`, `GET production/report`, `GET production/export.csv`,
`GET|POST waste/entries`, `POST waste/entries/:id/approve|reject|reverse`, `GET waste/report`, `GET waste/export.csv`.

## Old recipe-costing screen

Version 1.26.0 added a recipe-costing calculator (yield, overheads, margin, cost per portion). It is removed from the
screens, the API and the phone app. Its database tables (`menu_item_costings`, `preparations`, `preparation_lines`,
`production_runs`, `modifier_ingredients`, `order_item_costs`, and the extra ingredient columns) were **not dropped**:
the migration `20261111000000_recipe_costing` stays, so a server that already ran it keeps its rows. There is no
screen or export for those rows any more; read them with SQL if an audit needs them.
The older optional "deduct these ingredients when a dish is sold" setting on a menu item is a different feature and is
unchanged.

## Phones and the local network

The restaurant's OrderRestro server is the hub. If it is on the same Wi-Fi as the phones, the phones reach it by its
local address first and need no internet: sales, shifts, production, waste and receipts all sync over the LAN.
Phones do not talk to each other directly; a phone with no route to the server keeps everything and sends it later.
Each phone signs in with its own device id (`did` in its session); removing it under Settings > Phones ends that
session immediately.


## Costed batches, menu price and quality (added November 2026)

* **Costing and menu price** are stored apart. The batch keeps its frozen `ingredientCost`, `additionalCost`,
  `totalCost` and `unitCost`; the menu price is only ever changed by an explicit new price typed on the batch,
  by someone with `menu.price`, and is recorded in `menu_price_changes` (old, new, who, when, batch, unit cost then).
  A price that moved after the form opened is refused (`PRICE_CONFLICT`) and nothing is posted.
* **Selling price at posting**: every costed batch freezes the menu price in force when it was posted
  (`sellingPriceAtPost`, before any change the batch makes). Later price edits never alter it; batches posted before
  this column existed show "not recorded".
* **Quality inspection** is optional and separate: `PATCH /inventory/production/:id/quality` with
  `{ result: PASS | FAIL | NEEDS_REVIEW, grade?, notes? }`, permission `production.quality` (chefs, managers and
  inventory managers by default; owners always). A posted batch only; a fail needs a note. It never changes stock,
  cost or price. Each change writes an audit row holding the previous result, so history is kept. A batch with no
  inspection shows **Not recorded**, never "passed".
* **Reports** (`Inventory > Stock Journal Reports`, permission `production.report`) show, per batch: cost breakdown,
  menu price at posting, price changed to, batch ref, made/expiry dates, quality, and a full voucher drill-down
  (Source / Destination lines with rate and amount, additional costs). Search by batch, item or batch ref; sort by date
  or cost per unit; CSV for every section. Figures come from posted snapshots, never today's recipe or prices.
* **Entry screen**: guided five steps on a phone. On a wide screen the Source (Consumption) and Destination
  (Production) sections sit side by side in a live voucher summary.
* **Not built**: admin-defined custom report definitions. The reports are fixed and permission-gated, so there is
  nothing a configuration change could delete; production history cannot be removed from any report screen.
