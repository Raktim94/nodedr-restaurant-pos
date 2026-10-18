# Permissions, stock tracking, thermal printing, KDS station

## Roles: read-only menu/tables and the sales policy

| Permission | Grants |
|---|---|
| `menu.view` | Read categories, items (POS ordering, Menu page in view-only mode) |
| `menu.manage` | Everything in the menu editor; **implies** `menu.view` |
| `tables.view` | Read floors, tables and status; update table status / resolve guest requests when the role also has `orders.edit` |
| `tables.manage` | Create/move/delete tables and floors, QR tokens; **implies** `tables.view` |
| `dashboard.sales.view` | Dashboard revenue + trends, the MCP `dashboard_summary` tool, and every revenue/tax/customer-spend report |

`dashboard.sales.view` is **not** implied by `sales.view` (the restaurant manager holds that one).
Defaults: OWNER, ADMINISTRATOR, ACCOUNTANT, CASHIER. It can be granted to any custom role in
Settings → Roles.

Default WAITER: `orders.create`, `orders.edit`, `bills.print`, `menu.view`, `tables.view`.

UI and API are both enforced: the API guard (`PermissionsGuard` + `permissionSatisfied`) and the
dashboard shell, which redirects a URL the role may not open to its first permitted screen
(`apps/web/lib/route-access.ts`). Hiding a link is never the only check.

Sales-total reports (`sales-*`, `popular-items`, `slow-movers`, `payment-methods`, `discounts`, `tax`,
`peak-hours`, `food-cost`, `customers`, `retention`, `staff-sales`) now also need
`dashboard.sales.view`; the report catalog is filtered accordingly. **RESTAURANT_MANAGER and
INVENTORY_MANAGER therefore lose those reports until the permission is granted to their role.**

### Migration `20261018000000_read_permissions` (runs once)
- Adds the three permissions.
- Grants `menu.view` / `tables.view` to every role that already holds `orders.create` or the
  matching `*.manage` (custom roles included), so no one loses access they had.
- Grants `dashboard.sales.view` only to system roles OWNER, ADMINISTRATOR, ACCOUNTANT, CASHIER.
- Removes `tables.manage` from the **system WAITER** role only. Custom roles are untouched; an owner
  can re-grant it per role. Because it is a one-time migration, later revokes are never undone.

## Inventory when items are sold

Per menu item (Menu → Edit item → *Stock when sold*, needs `inventory.manage`):

| Mode | Effect on a paid sale |
|---|---|
| Not tracked (default) | Nothing |
| Recipe | Deducts each recipe line × quantity |
| Stock item | Deducts *quantity per sale* of one stock item as-is (bottled drinks, packaged goods) |

- Combos expand into their components; each component's own mode applies.
- Stock moves **once**, inside the same transaction as the OPEN→PAID update. Open, rejected or
  cancelled-before-payment orders never move stock; a repeated or concurrent checkout is rejected
  and its deduction rolled back (also guarded by a per-order CONSUMPTION lookup). Kiosk/online
  orders deduct when staff take payment.
- A shortage never blocks a sale (balance may go negative until the next stocktake).
- Tracked items with no recipe / no stock item are listed in a warning on the Inventory page
  (`GET /v1/inventory/tracking-status`); a sale that hits one is audit-logged
  (`inventory.deduction_skipped`).
- Existing items that already had recipe lines were set to *Recipe* by the migration; saving a recipe
  on an untracked item switches it to *Recipe*.
- **Refunds:** a money-only refund never changes stock. To put stock back, the refund names the units
  that physically came back (*Returned to stock* in the refund dialog / `returnedItems`). Those add
  `REVERSAL` movements (the original `CONSUMPTION` rows are never edited), go back onto the batches
  they were taken from, and are capped at quantity sold minus earlier returns.
- Cancelling is only possible before payment, so there is nothing to reverse. Admin-deleting a
  finished order keeps its stock movements (the ledger outlives the order).
- Migration `20261018010000_inventory_tracking_and_returns` is additive.

Also fixed on the way: order numbers were `count(today)+1`, which collided (HTTP 409) once any earlier
order of the day was deleted; they are now `max(sequence)+1`.

## Thermal printing

Both **Bill** and **KOT** have two paths in the POS:
- *Print / PDF (browser)*: HTML in a hidden iframe → OS print dialog (also Save as PDF). Unchanged.
- *Thermal print* / *KOT (thermal)*: `POST /v1/orders/:id/print/usb` and `/print/kot`, native
  ESC/POS text sent from the **server** to the branch printer. Nothing is rendered as an image.

### Connection (Settings → Thermal printer → Connection)
- **USB (on this server)** - the original path: a USB printer attached to the machine running the
  backend (Linux host with USB passthrough; kernel `usblp` first, libusb fallback).
- **Network (IP address)** - raw ESC/POS over TCP to `printerHost:printerPort` (default port **9100**,
  the JetDirect/"RAW" port most Epson-compatible LAN printers listen on). Enter the address, save it,
  choose *Network*, then press *Test kitchen ticket*. Settings shows "Printer reachable at host:port"
  or the reason it is not (refused, unreachable, timed out).
- **The printer must be reachable from the backend.** The backend opens the connection, not the
  browser. A server hosted in the cloud cannot reach a USB printer or a private LAN address in the
  restaurant; there, use the browser print buttons, a VPN to the restaurant network, or run
  OrderRestro on a machine inside it. This is why kitchen printing "did nothing" on remote servers.

### Kitchen tickets (KOT)
- One ticket per kitchen round and station, built from that ticket's own lines: order number, table
  (or order type), guest, time, quantity x item, modifiers, the line note and the order note. No prices.
- **No accidental duplicates.** The first print of a ticket claims it atomically (`printedCount` 0 → 1)
  before sending, so a double tap, a second tablet or a client retry cannot print it twice
  (`409 ALREADY_PRINTED`). If the printer fails the claim is released and a retry prints it once. A new
  round (*Add another round*) prints only its new ticket.
- **Intentional reprint:** `POST /v1/orders/:id/print/kot?reprint=true` or the KDS ticket's printer button
  on an already-printed ticket. Paper says `*** REPRINT #n ***`. (The KDS "reprint" button used to only
  increase a counter and print nothing.)
- **Errors:** an unreachable/misconfigured printer returns `503` with the reason; the last error is kept
  on the ticket (`lastPrintError`). Messages appear inline in the screen you pressed the button on.
- Test prints: *Send test print* (receipt slip with column ruler and accents) and *Test kitchen ticket*
  (sample ticket) - `POST /v1/orders/print/test[?kind=kot]`.
- Migration `20261019000000_kot_printing_and_cancel_audit` is additive (existing branches stay on USB).

Settings → Printer: paper width (58/80 mm), character set (CP858 default for Spanish and €, CP850,
CP437, WPC1252) and an optional column override.
- Columns: 58 mm → 32, 80 mm → 48 (576-dot head). Existing branches were migrated to the old fixed
  **42** columns so output does not change on upgrade; clear the field to use 48.
- Text is encoded natively in the chosen code page. Accents the page lacks are reduced to the base
  letter; anything else prints as `?`, is returned in `unsupportedChars`, the UI warns, and a line on
  the ticket itself says some characters could not be printed (use the browser path for those).
- Bold, alignment and size use printer commands; the job always ends with an explicit reset (size,
  bold, underline, inverse, alignment) before the cut. The KOT has no prices or taxes.
- Migration `20261018020000_printer_settings` is additive.

**Not verified on real printer hardware.** Byte output is covered by deterministic tests, and the
network path was verified end to end against a local TCP listener that records the bytes (ticket
contents, once-only printing, reprint stamp, dead-printer error and retry) - not against a physical
printer from any manufacturer, and no printer model or brand compatibility is claimed. How a given
printer renders the bytes is not tested. On the target model run *Send test print*: the ruler line should fill exactly one
line, the accents line should read `áéíóú ñ ü ¿? ¡! € £`, and the cutter should cut. Some clones
number code pages differently (`ESC t n`); if accents are wrong, try another character set.

## Table switching, cancelling and editing bills

Root causes fixed (all reproduced before fixing):
- **Table 1 "disappearing" / duplicate bills.** Creating or paying a bill did not refresh the cached
  list of open bills per table, so Table 1 → Table 2 → Table 1 showed Table 1 as empty and the next send
  opened a *second* bill; the list was also not refreshed by live updates from other terminals, and a
  send while the new table's bills were still loading could start a duplicate bill. One cart was shared
  by all tables, and only the first of several open bills on a table was reachable.
  The POS now refreshes the table's bills on every change/live event, waits for them before sending,
  keeps an unsent cart **per table**, lets you choose between several open bills, and follows
  `?tableId=` changes.
- **Table freed under a live bill.** Paying/merging one of two bills on a table marked the table
  Available, and the Tables screen let anyone set Available/Cleaning/Reserved on a table with an unpaid
  bill. A table is now released only when nothing else is open on it, and a manual change on a table
  with an open bill is refused (409).
- **Cancel "did nothing".** The Cancel button used the browser `confirm()` (silently suppressed on
  kiosk/PWA tablets), was shown to Cashier and Waiter who lack `orders.cancel` (every attempt a 403 with
  no visible message), and every `toast.*` message was invisible because the toast host was removed in
  1.3.0. Cancel is now an in-app dialog with a required reason, shown only to roles that can cancel,
  with the result and any error rendered inline.

Rules (server-enforced):
- Cancel (`POST /orders/:id/cancel`, `orders.cancel`): open and unpaid only; blocked once the kitchen is
  cooking or if any payment exists; the status flip is conditional so a racing checkout cannot also be
  cancelled. Releases the table (unless another bill is open there), withdraws the kitchen tickets
  (they leave the KDS). Nothing was paid and no stock was taken (stock leaves at checkout), so there is
  nothing to reverse. Reason, time and user are stored and audited; the order stays in History.
- Edit an **open** bill (`orders.edit`: Waiter, Cashier, Manager): lower a quantity
  (`PATCH /orders/:id/items/:itemId`), remove a line with a required reason
  (`POST /orders/:id/items/:itemId/remove`), move to another free table (`PATCH /orders/:id`), fix guest
  name/note. Subtotal, tax and total are recomputed from the lines; lines the kitchen has started are
  locked; the last line cannot be removed (cancel instead); raising a quantity goes through *Add another
  round* so the kitchen gets a new ticket. Every change is written to the audit log with before/after.
- **Paid bills are never edited in place** (`400`). Correct them with *Refund* (money, and stock for the
  units that came back). Admins can still delete finished orders (password-confirmed, audit snapshot).
- Moving a bill onto a table that has its own open bill is refused (409); merge the bills instead.

## KDS station

The only persisted KDS control is the station filter. It is a **device** setting (each kitchen screen
shows its own station), so it lives in the browser per branch (`kds-station:<branchId>`) and is
intentionally not shared across devices. Selection is read for the current branch on every render
(no previous-branch flash), tickets are not fetched until the saved station is confirmed to exist,
a deleted station falls back to "All stations" with a notice, and a blocked browser store shows a
"will reset on reload" message. The notification mute is a separate per-device setting.

## Tests

- `npm test` (backend): permission policy against real controller metadata, sales-report gating,
  stock planning, ESC/POS bytes/wrapping/code pages/KOT/test slip.
- `npm test` (web): route access by role, KDS station storage, per-table cart drafts, realtime cache keys.
- `LIFECYCLE_E2E=1 npm run test:e2e -- orders-lifecycle`: table switching, cancel, bill edits, role
  allow/deny and KOT printing against a local TCP "printer".
- `apps/web/e2e/bill_flow.py` (Playwright): table switching, edit, cancel, printer card, 375/768/1440 px.
- Opt-in end-to-end against a seeded database: `PERMISSIONS_E2E=1`, `INVENTORY_E2E=1`, `KIOSK_E2E=1`
  with `npm run test:e2e -- <name>`.
