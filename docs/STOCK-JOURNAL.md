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

## Stock journal voucher and stock report (added November 2026)

* **Voucher** (`Inventory > Production > Stock journal voucher`, and the **Manufacturing** card under the menu on the
  POS screen). Tally-style: header (date, batch/run no., location, shift, made on, use by), **Source / Consumption**
  on the left (item, available stock, quantity, unit, rate, amount; "Fill from recipe" shows expected quantity beside
  what you type), **Destination / Production** on the right (several finished products allowed), optional additional
  costs, quality result and grade, narration. Side by side from the 2xl breakpoint (1536px) so the item tables are never clipped; stacked, source first, below it.
  The voucher number is assigned on posting. Posting is the existing single transaction; the review step shows
  server-calculated rates, amounts, total production cost and cost per unit, and blocks posting on a shortage.
  Costs are worked out only when exactly one product is made and costing is on; with several products the voucher
  records quantities and consumption only. The menu selling price is never changed here.
* **POS card**: always shown to anyone with `production.record`, whether or not costing is switched on.
* **Stock report** (`Inventory > Stock report`, `GET journal/summary`, `journal/summary.csv`): per item and storage
  location, opening, purchases/receipts, manufacturing used, manufacturing produced, sales, waste, adjustments,
  closing for a date range. Every figure is summed from the stock ledger; the e2e test checks
  opening + movements = closing = live stock.

### Where the Manufacturing voucher opens from (added after 1.33.0)

* **Inventory > Purchase Orders** (list and each PO): a **Manufacturing** button. From a PO it carries the context over: the PO number becomes the batch/run number, the narration says which PO and supplier, and the source rows start with the items that PO actually received (quantities left blank to type).
* **Inventory > Stock journal**: **Manufacturing voucher** button next to Adjust stock / Receive stock (the ledger itself is unchanged).
* **Inventory > Production** and the **POS** screen, as before.
* The voucher shows the ingredient-use variance against the recipe (same-unit rows) after "Fill from recipe".
* **Stock Journal Reports** gained **Daily production**: per day, what was consumed (with cost) and what was produced, from posted vouchers only, with CSV export.

## Manufacturing journal v2 (1.34.0)

**Voucher.** One voucher records materials consumed (Source / Consumption) and products made (Destination / Production)
together, side by side on desktop, stacked on phones. Source rows: item, available stock, quantity, unit, expected (from the
recipe) with variance, rate, amount, **place** to take from, optional lot, and "Only <product>" (direct material). Destination
rows: item, **good quantity** (added to stock), **rejected quantity** (recorded, never stocked), unit, **place** to put into,
lot, and a cost percent when the split is manual. Voucher-level: date, batch/reference no., location, shift, made-on/use-by,
narration, quality result/grade/notes. The voucher number (`PR-YYYYMMDD-nnn`, local date) is assigned on posting; a draft
changes nothing. A double submit (same idempotency key) posts once.

**Recipes (BOM).** `Inventory > Recipes`: a recipe belongs to a finished product and says what a **base output quantity** takes.
Several recipes per product are allowed; the voucher lets you choose one. "Fill from recipe" scales it to the planned good
quantity; you then type what was actually used. Editing a recipe bumps its version. When a voucher is saved, the chosen recipe
(name, version, base output, lines) is **copied into the voucher** (`recipeSnapshot`) and each line keeps its expected quantity,
so later recipe edits never rewrite a posted batch. Menu-item recipes (the older "deduct on sale" lines) are offered too,
labelled "menu recipe", with base output 1 unless the item has a costing batch size. A voucher with no recipe says so.

**Cost basis (unchanged, now documented).** Ingredient rate = the rate typed on the row, else the item's **weighted-average
cost** (`Ingredient.costPerUnit`, moved by receipts with a cost and by costed production). Not FIFO, not last purchase. The rate
and line cost are frozen on the voucher at posting. Stock itself is drawn FIFO from batches; the cost basis is the average.

**Cost formula.** batch cost = materials + included additional costs − recovered scrap/by-product value ("Recovered scrap /
by-product" is a cost category that is subtracted). One product: unit cost = batch cost ÷ good quantity. Several products:
a material marked "Only X" is direct to X; everything else plus additional costs and recovery is **shared** and is split by
**good quantity** (all outputs in one unit) or **manual percent** (must total 100). Allocated cost = direct + share; unit cost =
allocated ÷ that product's good quantity. Rounding: shares to 4 dp; the remainder goes to the first product so the parts always
sum to the batch. Rejected pieces carry no stock; their cost stays in the batch and is carried by the good pieces (the screen
says so). With the split missing or incomplete the review shows a message and **no** per-product cost. The menu selling price is
never changed by a voucher.

**Places per row.** `production_lines.locationId/locationName`, `stock_movements.locationId` (both plain columns, nullable;
older rows stay null = "unassigned", never guessed). Posting takes from a place only if that place holds the quantity (else the
whole voucher is refused) and adds output to its place; the item's total moves exactly as before. Reversing restores both.
The Stock journal page and CSV have a Place filter/column.

**Reports.**
* `Inventory > Stock Journal Reports > Daily production` (`GET manufacturing/daily`, `.csv`): one block per **local** date (the
  restaurant timezone, Asia/Kolkata by default), posted vouchers only (drafts and reversed ones never appear; a corrected
  voucher shows once, as its replacement). Filters: date range, product, batch/reference, PO number or supplier, place. Each
  voucher expands to the full Source/Destination with expected, variance, rate, cost, good, rejected, yield, allocated cost,
  unit cost, split method, quality, narration, source PO and recipe/version. CSV uses the same filters; its rows add up to the
  voucher totals.
* `Inventory > Yield analysis` (`GET manufacturing/analysis`, `.csv`): per product, batch by batch: good, rejected, reject %,
  yield vs plan, batch cost, cost per good unit, quality note, and each ingredient **per 100 good units** beside the recipe
  expectation and variance %, plus the weighted cost per good unit by day. It never ranks a batch as better.
* `Inventory > Stock report` still reconciles opening + receipts + manufacturing − use ± sales/waste/adjustments = closing.

**POS.** Each menu item linked to a finished product shows its latest posted production cost under the selling price
(`GET manufacturing/menu-costs`, needs `production.report`; cashiers without it see nothing and can still sell). Cost per
portion = Σ allocated cost ÷ Σ good quantity over that product's posted vouchers on the latest day with any, × stock quantity
one sale uses. It is labelled "Today's production cost" only when that day is today (restaurant time); otherwise it shows the
date and says "not today". The difference shown is price − cost, before expenses, discounts and tax; prices are never changed.

**Purchase orders.** `Manufacturing` on the PO list and on each PO opens the voucher; from a PO it carries the PO number as the
batch/reference, a narration with the PO and supplier, and starts the source rows with the items that PO actually **received**
(quantities left blank). The PO number, id and supplier are stored on the voucher as a reference only: producing never receives
stock again, and repeated runs against one PO each get their own voucher number.

**Migration** `20261118000000_manufacturing_journal_v2` is additive (new nullable columns, a column with a zero default, two new
tables); nothing is dropped or rewritten, and every earlier voucher reads exactly as before.

## One stock journal for every kind of entry (1.36.0)

`Inventory > Stock journal` now opens on **Journal**: every entry in one list, whatever kind it is.
**New stock journal** asks what happened first, because each kind moves stock differently:

| Kind | What it does to stock | Who |
|---|---|---|
| **Stock transfer** | Moves quantity from one place to another (or from "not yet placed" into a place). The item's total never changes. A destination is required and must differ from the source. Writes the same place levels and `location_transfers` history as Areas > Move stock. | `inventory.manage` |
| **Production or preparation** | The existing voucher: ingredients consumed, products made, in one transaction. Now also has **Save draft**. | `production.record` to draft, `production.post` to post |
| **Waste or spoilage** | Stock leaves, and each row becomes a real waste record (`waste_entries`, key `sj:<lineId>`), so the Waste reports, costs and large-waste approval all include it. A reason per row is required; "Other" needs a note. | `production.record` |
| **Stock correction** | Each row either **removes** or **adds** the difference, as an `ADJUSTMENT` movement. A reason is required. Adding uses a zero-cost batch and leaves the average cost alone, exactly like Adjust stock > Add. | `inventory.manage` |

The form for transfer, waste and correction has three parts: details (date and time, reference given when saved, reason), items (searchable item picker, quantity, unit, places, reason/note) and a **review** that lists what leaves stock, what enters it, the places affected, the value at average cost (only for people with `production.report`, and only when every item has a cost) and any shortage. A shortage blocks posting. **Save draft** changes nothing; **Post journal** asks for confirmation and then updates stock.

**Rules**

* Tables `stock_journal_entries` / `stock_journal_lines` (migration `20261120000000_stock_journal_entries`, additive; also adds `stock_movements.journalEntryId`). Numbers `SJ-YYYYMMDD-nnn` on the restaurant's local date.
* Posting claims the draft with a conditional update, locks every item in a fixed order and makes every change in one transaction. A second post is refused (409) and changes nothing. A retried create with the same `idempotencyKey` returns the first entry.
* Posted entries are never edited. **Reverse** (`production.void`, reason required) puts every change back and keeps the entry as *Reversed*. A transfer cannot be reversed once the destination no longer holds the quantity; a correction that added stock cannot be reversed once that stock was used.
* A waste record written by a journal entry cannot be reversed from the Waste page (reverse the entry instead). A manager can still reject it there; the journal then shows that row's waste record as rejected.
* Quantities: more than zero, up to 3 decimals, units converted exactly as elsewhere. Stock and places never go below zero.
* Entry numbers (stock journal and production) now take the highest number used that day instead of counting rows, so deleting a draft can no longer make the next save collide with an existing number.

**List**: search by reference (SJ-…, PR-…, batch ref) or item name; filter by date range, kind, status (Draft / Posted / Reversed) and place; sort by date or reference. Click a row for the full movement, the audit trail (created / posted / reversed, by whom and when) and the actions that apply (post, edit or delete a draft; reverse; correct for production).

**API** (`/api/v1/inventory`, `?branchId=`): `GET|POST journal/entries`, `GET|PATCH|DELETE journal/entries/:id`, `POST journal/entries/:id/post`, `POST journal/entries/:id/void`. `GET journal/entries` merges production entries in, filtered by `q`, `type`, `status`, `from`, `to`, `locationId`, `sort=date|ref`, `dir=asc|desc` (300 rows max).

**Export**: `GET journal/entries.csv` (same filters, one row per item line; values only with `production.report`).

**Not built**: offline queueing of these three kinds on the phone app (the web form needs the server; the idempotency key protects retries).


## Recipes, drafts and add-item from the voucher (1.40.0 work)

* **"No saved recipes yet"** means the restaurant has no recipe (bill of materials) at all. For a product that has none it reads
  "No saved recipes for this product yet". A recipe is a reusable list of ingredients and quantities for one finished product.
  Saving a recipe never changes stock; only posting a voucher does. Existing recipes are listed from `GET inventory/recipes`
  (all active recipes until a product is chosen, then that product's), so the message appears only when that list is empty.
* **Save as recipe** (needs `inventory.manage`) in the voucher saves the current rows as a recipe for the single finished product,
  base output = the good quantity typed, and selects it. **Create recipe** opens Inventory > Recipes in a new tab so the voucher keeps its data.
  Picking a recipe while Destination is empty also picks its product. "Fill from recipe" still lets you edit every quantity.
* **Three different actions**: *Save as recipe* (a template, no voucher), *Save draft* (a voucher, no stock change), *Post voucher* (stock moves, once).
* **+ Add inventory item** (raw material, not put on the menu) and **+ Add menu item** (finished product, put on the POS menu by default) open
  the existing add dialog; the new item is selected in the row last worked in, or the first empty row.
* **Production drafts can be reopened**: Journal > open a draft > *Edit draft* or *Delete draft* (`production.record`). Saving edits the same
  entry (`PATCH production/:id`); *Post* from the edited draft saves, then posts (the server posts a draft once; a second post is refused with 409).
  `GET production/:id` now also returns the entry's additional costs.

## Customers: PIN code and status

`customers.pincode` (optional) and `customers.status` (`ACTIVE` default, `INACTIVE`) — migration `20261122000000_customer_pincode_status`,
additive; existing customers become ACTIVE with no PIN code. PIN code follows the same rule as saved delivery addresses (3-10 letters, digits,
space or dash), so every country the app supports works; an empty value clears it. Status is a label: it does not block orders or change loyalty.


## Product-first recipes, permissions and costing (1.40.0 work)

* **Recipes are per product.** Nothing is requested until the Destination product is chosen; then `GET inventory/recipes?productId=` decides what shows.
  "No saved recipes for this product yet" appears only for a request that succeeded and returned an empty list for that product. No product chosen,
  a request in flight, and a failed request each have their own message (a failed one offers *Try again*). Rule and wording live in
  `apps/web/lib/voucher-rules.ts` (web) and `mobile/www/pos/lib/stockjournal.js` (phone), both unit tested.
* **Who can do what** (the server enforces each; the screens only hide what would be refused): reading/filling recipes and saving drafts need
  `production.record`; posting needs `production.post`; creating or editing recipes and adding inventory items need `inventory.manage`; adding a menu
  item also needs `menu.manage`; correcting or reversing a posted voucher needs `production.void`. A record-only account sees *Save draft* and a note that
  someone with post permission must post.
* **A posted voucher is never edited or deleted.** `PATCH` and `DELETE` on a posted entry are refused (400, "Only a draft can be edited / deleted"). To change one,
  *Correct* (reverse the old entry, post a replacement, link both, keep the reason) or *Reverse*. A failed correction changes nothing.
* **Missing cost.** With costing on, an ingredient with no cost blocks posting (the review says so and Post stays disabled). Fix it by typing a **Rate**
  for the ingredient on the voucher (this voucher only) or by receiving the ingredient with a unit cost on a purchase order; nothing is invented.
* **Units.** The unit picker only offers units the item can convert; an incompatible unit (for example from a draft or recipe) gets a sentence naming the
  item, its stock unit and the allowed ones, and the server refuses it too.

## Stock journal on the phone (Android and iOS app, 1.40.0)

`Kitchen > Stock journal: record production` replaces the old "Record production" sheet. Same routes, rules and permissions as the web voucher; the phone
adds no stock logic. Signing in to the phone POS needs `orders.create`, which is existing policy.

* **Flow**: choose the product made; its recipes load (states: choose product, loading, error + Try again, offline, **No saved recipes for this product yet**,
  list); *Fill from recipe* asks the server to scale it to the good quantity typed; rows show **Available** stock (live, when online) and what the recipe
  expects; every number stays editable. Batch/reference, shift and narration are supported; rejected quantity too.
* **Add inventory item** (raw material only) and **Add menu item** (finished product + menu entry + stock link, same three calls as the web) are separate
  buttons; the new item is selected in the row being worked on; duplicate names are refused by the server and shown.
* **Review and post** uses the server's `voucher-preview` (shortages, missing cost, cost per unit). **Post** is written on the phone first and sent at once;
  with no connection it waits and is sent later, once (its id is the idempotency key). A refusal is shown on the form with everything still typed in.
  **Save draft** and **Save as recipe** need a connection (they live on the server) and never move stock. **Drafts and posted vouchers** lists server drafts
  (open, edit, post, delete) and the latest posted vouchers (read only).
* **Costing**: the phone asks `GET manufacturing/settings` and sends `costing` when it is on, like the web. Additional costs (labour, packaging) are typed in the web app.
* **What the account may do** comes from `stockCaps` in the standalone snapshot (`record`, `post`, `recipes`, `inventoryItems`, `menuItems`, `report`). Older
  servers lack it: the phone then offers record and post as before, and nothing that needs the newer routes.
* **Not lost**: the form is kept on the phone as it is typed and restored after a restart or resume ("Clear" empties it).
