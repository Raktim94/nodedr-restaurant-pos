# Bulk import from CSV

Load your whole menu or ingredient list from a spreadsheet instead of typing
each one. Open **Menu** or **Inventory** and press **Import CSV**.

Ready-made files you can open in Excel, Google Sheets or LibreOffice:

- [`docs/examples/menu-items.csv`](./examples/menu-items.csv)
- [`docs/examples/ingredients.csv`](./examples/ingredients.csv)

The same files (and a blank template) download from the Import dialog.

## How to use it

1. Press **Import CSV** and **Download example file**.
2. Replace the sample rows with your own. Keep the first row (the column names).
3. **Save as CSV.** In Excel: *File → Save As → CSV UTF-8 (Comma delimited)*.
4. Choose the file. You get a **preview** of exactly what will be added,
   changed or left alone, and a list of any rows with problems (with their
   line numbers). **Nothing is saved until you press Import.**

Importing the same file twice is safe: existing items are updated in place,
never duplicated.

## Menu items

Required: `name`, `category`, `price`. Everything else is optional.

| Column | Example | Notes |
|---|---|---|
| `name` | Paneer Tikka | |
| `category` | Starters | Created if it does not exist yet (the preview lists new ones) |
| `price` | 280 | Selling price **including tax**. `₹1,200.50` and `Rs. 90` are fine |
| `half_price` | 160 | Turns on the Half / Full picker. Must not exceed `price` |
| `tax_rate_percent` | 5 | 0–100. Default 0 |
| `sku` | STR-001 | Your own code. Best way to match items on later imports |
| `description` | Char-grilled… | Wrap in "quotes" if it contains a comma |
| `station` | Tandoor | Kitchen station; created if new |
| `is_veg` | yes / no | Also `veg`, `non-veg`, `true`, `false`, `1`, `0`. Default yes |
| `spice_level` | NONE, MILD, MEDIUM, HOT, EXTRA_HOT | |
| `prep_time_minutes` | 15 | Whole number |
| `cost_price` | 110 | |
| `calories` | 320 | Whole number |
| `allergens` | dairy;nuts | Separate with `;` or `\|` |
| `available_from`, `available_to` | 06:00, 22:00 | 24-hour. Set both or neither |
| `is_active` | yes / no | no = hidden from the POS. Default yes |

**Matching.** A row is the same item as an existing one if the `sku` matches;
otherwise if the `name` and `category` match (ignoring capital letters). A row
that matches an item without a SKU fills in its SKU rather than adding a copy.

**Blank cells never erase data.** On an update, a blank cell leaves the
current value as it is. To clear a value, change it in the app.

## Ingredients

Required: `name`, `unit`.

| Column | Example | Notes |
|---|---|---|
| `name` | Basmati Rice | Matched ignoring capital letters |
| `unit` | KG | KG, G, L, ML, PIECE, DOZEN, PACK, BOX. Also `kg`, `gm`, `ltr`, `pcs`, `packet`… |
| `sku` | ING-002 | |
| `reorder_level` | 25 | Low-stock alert threshold |
| `cost_per_unit` | 95 | Per one `unit` |
| `opening_stock` | 60 | See below |
| `is_active` | yes / no | |

**Opening stock is only for ingredients with no stock history.** It is recorded
as a normal stock entry ("Opening stock (CSV import)"). If the ingredient
already has stock movements, the file's stock figure is **ignored** and you are
told so — an import must never overwrite a real count. Use *Adjust stock* in
Inventory for that.

**An existing ingredient's unit cannot be changed by import** (its recorded
quantities would be wrong); that row is reported as a problem.

## Rules and limits

- Up to **2,000 rows** and **2 MB** per file; split bigger lists.
- The file may use commas, semicolons or tabs, UTF-8 or Excel's Windows-1252
  (you are told if the second was assumed).
- A value containing a comma must be wrapped in "quotes". A row that has more
  values than the header (the usual sign of a missing quote) is rejected rather
  than imported shifted.
- Text starting with `=`, `+`, `@` or `-` followed by a letter is refused, so a
  menu name can never become a spreadsheet formula when exported.
- **All or nothing by default.** If any row has a problem, nothing is imported
  until you fix the file — or tick *Import the good rows anyway* to skip the bad
  ones. The problem list can be downloaded as a CSV.
- Permissions: importing menu items needs *Manage Menu*; importing ingredients
  needs *Manage Inventory*. Every import is recorded in the audit log (counts
  and file name only, not the contents).

## API

`GET /api/v1/imports/templates/{menu|ingredients}[?example=1]`
`POST /api/v1/imports/{menu|ingredients}/preview?branchId=…` (multipart `file`)
`POST /api/v1/imports/{menu|ingredients}/commit?branchId=…&updateExisting=true&skipInvalid=false`

The commit re-reads and re-validates the file itself; it does not trust a
previous preview.
