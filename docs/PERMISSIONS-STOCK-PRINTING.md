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
- *Thermal print* / *KOT (thermal)*: `POST /v1/orders/:id/print/usb` and `/print/kot/usb`, native
  ESC/POS text sent to the USB printer attached to the **server** (Linux host with USB passthrough).
  Nothing is rendered as an image.

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

**Not verified on hardware.** Byte output is covered by deterministic tests; how a given printer
renders it is not. On the target model run *Send test print*: the ruler line should fill exactly one
line, the accents line should read `áéíóú ñ ü ¿? ¡! € £`, and the cutter should cut. Some clones
number code pages differently (`ESC t n`); if accents are wrong, try another character set.

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
- `npm test` (web): route access by role, KDS station storage.
- Opt-in end-to-end against a seeded database: `PERMISSIONS_E2E=1`, `INVENTORY_E2E=1`, `KIOSK_E2E=1`
  with `npm run test:e2e -- <name>`.
