# Roadmap / Living TODO

Checkboxes are the actual status — trust these (and `git log`) over prose in
`PROJECT.md`. Update this file at the end of every work session.

For the full public-facing feature taxonomy (POS/billing, tables, KDS,
inventory, CRM, payments, security, AI, etc. — ~305 line items each marked
Shipped/Partial/Planned against the real codebase) see
[`FEATURE-CHECKLIST.md`](./FEATURE-CHECKLIST.md). This file tracks the same
ground phase-by-phase for engineering; that one is organized by product
category for anyone (including the website) that wants "what does OrderRestro
actually do today."

## Current phase: 4 complete (incl. order deduction) → procurement depth + Phase 5 next

Started 2026-08-03. Phases 0-3 finished and verified the same day. Phase 4's
core (ingredients, recipe costing, suppliers, purchase orders, GRN,
batch/lot, waste) landed 2026-08-04, and automatic ingredient deduction on
order checkout (the one Phase 4 item deferred that day) landed later the
same day — both verified numerically end-to-end, not just built — see
Session log. Procurement depth (vendor quotations, purchase requests,
vendor invoices/payment tracking, supplier performance) and a few
Phase-4-adjacent items are deliberately deferred — see the
checkboxes below and "Explicitly deferred" for what and why.

---

### Phase 0 — Foundation

- [x] Planning docs (`PROJECT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DESIGN_SYSTEM.md`)
- [x] Monorepo scaffold (pnpm workspaces + Turborepo). **Deviation:** no
      separate `packages/config` — shared eslint/tsconfig didn't earn its
      abstraction yet with only 2 apps; revisit once a 3rd app needs it.
- [x] `packages/types` — shared Zod schemas/DTOs (permissions, auth, menu,
      tables, orders), built to CJS (`tsc`) so both apps can `require()` it —
      not left as raw `.ts` source (that broke Node's runtime resolution,
      see git history).
- [x] `apps/backend` NestJS skeleton — module-per-domain (`menu`, `tables`,
      `orders`, `kds`, `dashboard`, `restaurants`), Swagger at `/api/docs`,
      versioned routes (`/api/v1`)
- [x] Prisma schema v1 (auth/RBAC + menu + tables + orders/KOT/payments core), PostgreSQL
- [x] Auth: JWT httpOnly cookie login, PIN login endpoint (`pin-login`),
      session bootstrap via `/auth/me`
- [x] RBAC: Role + Permission tables, `@Auth('permission.key')` decorator
      (combines JwtAuthGuard + PermissionsGuard), full permission list seeded
      per role, individually toggleable in the DB
- [x] `apps/web` Next.js skeleton. **Deviation:** route groups ended up as
      `app/login` (public) + `app/(dashboard)/*` (authenticated shell) rather
      than the originally sketched `(auth)`/`(pos)`/`(kds)`/`(order)` groups —
      POS/KDS are just pages inside the one dashboard shell, which is simpler
      and still correct; a public QR-ordering route group is genuinely new
      (Phase 2+), not a deviation.
- [x] Design system foundation — Tailwind v4 theme tokens (wine/burgundy
      primary, full light+dark palettes), shadcn/ui (Base UI) initialized,
      responsive `AppShell` (desktop sidebar + mobile Sheet drawer, verified
      at 390px/1440px + dark mode via real screenshots). **Deviation:** lives
      in `apps/web/components/ui` (standard shadcn location), not a separate
      `packages/ui` workspace — only one frontend app exists so far; extract
      to a shared package when a second one needs the same components.
- [x] Docker Compose (`postgres`, `backend`, `web`), `.env.example`, root
      README — both images built and run for real via `docker compose up`,
      not just written and assumed to work (see Session log for the two
      pnpm-monorepo packaging bugs this caught).
- [ ] Base CI (lint+typecheck+build on push) — `.github/workflows` — not done
      this session, next up.

**Permission list (seed data, granular, matches spec):** view_sales,
create_orders, edit_orders, cancel_orders, apply_discounts, process_refunds,
print_bills, manage_tables, manage_menu, manage_inventory, access_reports,
manage_users, view_financial_reports, export_data — extended per-module as
later phases add domains. Roles seeded: Owner, Administrator, Restaurant
Manager, Cashier, Waiter, Kitchen Staff, Chef, Bartender, Delivery Staff,
Accountant, Inventory Manager — each a named bundle of permissions, but
every permission independently toggleable per role (never hardcoded).

### Phase 1 — Core vertical slice (dine-in POS, end to end) — ✅ DONE

Goal: a real restaurant could open a table, take an order with modifiers,
send a KOT to a kitchen station, see it on a KDS, mark it ready/served, bill
and pay — achieved and verified via real API calls + full Playwright
click-through (login → menu → tables → POS → KDS) against real Docker
containers, not just "it compiles."

- [x] **Menu management**: categories, items (name, price, tax rate,
      category, kitchen station, veg/non-veg, spice level, allergens,
      availability window), modifier groups + modifiers (price adjustment,
      default selection — pre-selected in the POS picker, max selection),
      table-based CRUD UI (categories sidebar + items table)
- [x] **Floor & table management**: floors, table entity (number, name,
      capacity, status enum, assigned waiter, notes), status changed via a
      dropdown on each table tile. **Scope cut, not silently dropped:** the
      full drag/resize/rotate floor *designer* (dnd-kit) is NOT built —
      `posX`/`posY`/`width`/`height`/`rotation` already exist on the `Table`
      model and the Tables page already renders tiles at those coordinates
      (a real spatial floor view, seeded layout), but there's no UI yet to
      drag a tile and persist a new position (`PATCH /tables/layout` exists
      backend-side, unused by the frontend). Fast-follow, tracked here so it
      doesn't get lost.
- [x] **POS order screen**: dine-in + takeaway, product grid with
      category tabs + search, modifier picker (respects min/max, pre-selects
      defaults), cart with qty stepper, client-side price preview
      (`lib/pricing-preview.ts`, mirrors backend, server always
      re-authoritative on submit)
- [x] **KOT**: generated on order submit, split by kitchen station,
      status flow NEW→ACCEPTED→PREPARING→READY→SERVED(→CANCELLED)
- [x] **KDS**: per-status columns (not per-station columns — see below),
      live elapsed-time timer, warning ring past 15 minutes, bump-to-next-
      status button, real-time via the Socket.IO `RealtimeGateway` (branch-
      room push, not polling) — verified a ticket appear/move without a
      manual refresh. **Scope note:** columns are grouped by KOT *status*
      (New/Accepted/Preparing/Ready), not by kitchen *station* — station
      filtering exists backend-side (`GET /kds/tickets?stationId=`) but the
      frontend doesn't yet offer a per-station view/tab; each ticket does
      show its station name. Fast-follow.
- [x] **Billing/checkout**: tax-inclusive pricing with GST/VAT correctly
      backed OUT (never added on top — verified numerically, e.g. a ₹480
      item at 5% backs out to exactly the right tax, a 10% discount on a
      ₹920 cart lands on exactly ₹828), %/flat discount, cash/card/UPI/wallet
      payment record. **Update (2026-08-04):** receipt printing shipped —
      `GET /v1/orders/:id/receipt` renders a self-printing HTML receipt
      (ported from `nodedr-pos`'s `backend/src/lib/receipt.js` layout rules),
      loaded into a hidden iframe and printed via the browser's own dialog
      (any printer, or "Save as PDF"), triggered by a **Print receipt**
      button on the post-checkout screen. A dedicated PDF-download endpoint
      and direct-USB ESC/POS printing (nodedr-pos's other two print paths)
      remain a Phase 8 hardware item.
- [x] **Dashboard v1**: today's revenue, today's orders, table status
      breakdown, kitchen queue counts, recent transactions — bento-grid
      cards, 15s polling refresh (not yet wired to the realtime gateway;
      KDS/tables are, dashboard fast-follow).

### Phase 2 — Kitchen depth + Reservations — ✅ DONE

- [x] Kitchen stations were already first-class config (Phase 1). Added this
      phase: reprint KOT (`POST /kds/tickets/:id/reprint`, increments
      `printedCount`), priority toggle (star icon on the ticket card, ring
      highlight same as the 15-min delay warning), kitchen performance
      report (`GET /kds/performance` — avg minutes-to-ready per station
      today, small widget atop the KDS board). **Scope note:** "delay
      alerts" is the existing Phase 1 visual (warning ring past 15 min) —
      no separate push notification was added, the KDS screen itself is the
      alert surface.
- [x] Reservations: customer name/phone/email, guest count, date/time/
      duration, assigned table, special requests, deposit (schema only, no
      payment collection UI yet), full status flow (reserved→confirmed→
      arrived→completed/cancelled/no_show) with table-status side effects
      (assigning a table on create marks it RESERVED, ARRIVED occupies it,
      terminal statuses release it back to AVAILABLE — mirrors the same
      side-effect pattern checkout() uses for dine-in orders). **Scope
      cut:** no reminder notifications (would need Phase 8's SMS/email/
      WhatsApp integrations) — `reminderSentAt` exists on the schema,
      unused.
- [x] Waitlist: name/phone/party size/quoted wait, WAITING→SEATED/CANCELLED,
      seat action assigns a table and marks it OCCUPIED. Lives as a panel
      on the Tables page (not a separate nav item) since seating a waitlist
      guest is a table-floor action.
- [x] Table QR generation (opaque per-table token, rotate/regenerate
      invalidates the old one) + public read-only menu view at
      `/order/[qrToken]` — unauthenticated, no ordering yet (that's still
      Phase 5), verified with both a valid token (renders categories/items/
      veg-nonveg indicator) and an invalid one (empty-state, not a raw
      error page).

### Phase 3 — CRM + Loyalty + Combos — ✅ DONE

- [x] Customer profiles (phone/email/address/birthday/anniversary/
      allergies/notes) + order history + a profile page
      (`/customers/[id]`) showing loyalty balance, store credit, gift
      cards, and paid-order history. Attachable to a POS order via a
      name/phone search-and-attach picker in the cart panel.
- [x] Loyalty: 1 point earned per ₹100 of net spend (floor, excluding tip),
      1 point = ₹1 redeemable discount, redemption capped at the customer's
      actual balance (re-checked inside the checkout transaction, not
      trusted from a pre-transaction snapshot) and at the bill total.
      **Scope note:** the earn/redeem rate is a fixed constant for now
      (`LOYALTY_POINT_VALUE` / `LOYALTY_EARN_PER_CURRENCY` in
      `orders.service.ts`), not yet a per-restaurant configurable program —
      real "memberships" (tiers) are not built, only the points ledger.
- [x] Gift cards: issue (random code + balance), balance lookup, redeem as
      a checkout payment source — debits up to the remaining amount due
      (never more than the card's balance), read-modify-write with
      `round2` + `set` (not a DB `increment`, per this project's standing
      Float-balance discipline). "Gift vouchers" and gift cards are treated
      as the same feature here, not two separate systems.
- [x] Combo meals: a menu item can declare component items + quantities
      (`ComboComponent`, editable via a builder dialog in Menu
      management — the "Layers" icon on each item row). Setting/clearing
      components toggles `MenuItem.isCombo` automatically. **Scope cut,
      not silently dropped:** components are informational/kitchen-facing
      only — a combo still has its own flat selling price, and there's no
      automatic ingredient stock deduction across the bundle yet (that
      needs Phase 4's inventory system to exist first; tracked there, not
      forgotten).
- [x] Billing depth: tips (added on top of the discounted subtotal, not
      taxed), refunds (capped at what's actually refundable — total minus
      prior refunds on that order — with an optional store-credit payout
      that credits the customer's wallet), and merging two open dine-in
      orders into one (moves items + KOTs, recomputes subtotal/tax, cancels
      the source order, releases its table). **Scope cut, documented:**
      "split bill" is a display-only equal-split calculator in the
      checkout panel (shows each guest's share so the cashier can collect
      cash from each), not a system that produces separate checks/receipts
      per guest — this app's Order model finalizes OPEN→PAID as one unit,
      and building true per-guest sub-bills would mean a real data-model
      change, not a quick add. Revisit if a future session needs it for
      real.

### Phase 4 — Inventory & Procurement

- [x] Ingredient-based inventory: raw materials, weighted-average cost per
      unit (recomputed on every GRN), reorder level / low-stock flagging.
      **Deviation:** one base unit per ingredient, no unit-conversion engine
      (buy a 25kg bag, stock/recipe in kg) — see "Explicitly deferred" below.
- [x] Recipes: menu item → ingredient quantities (`RecipeIngredient`), live
      cost computed from current weighted-average ingredient cost and
      snapshotted onto `MenuItem.costPrice` on save.
- [x] Automatic ingredient deduction on order checkout. Deducts via FIFO
      batch consumption inside the checkout transaction, for every order
      item with a recipe modeled (combos expanded one level into their
      component items first). Deliberately **allows stock to go negative**
      instead of blocking the sale — see the Session log entry below for
      the reasoning and the numeric verification.
- [x] Purchase orders (draft → sent → partially received → received /
      cancelled, sequential PO numbers), supplier management, goods
      received (GRN) linked or unlinked to a PO, each GRN line creating a
      batch and a stock-ledger entry.
- [ ] Stock transfers (branch-to-branch) — deferred to Phase 6 (multi-branch
      work needs to land first; a single-branch transfer has no real
      counterpart yet).
- [x] Stock adjustments (manual stocktake corrections, ledgered).
- [x] Waste recording (reason-coded, FIFO-consumed from the oldest batch,
      priced at that batch's own cost — not a blended average).
- [x] Expiry tracking (optional `expiryDate` captured per batch on receipt)
      and batch/lot numbers (auto-generated `GRN-000N-n` or supplier-
      provided). **Deviation:** expiry is stored and visible per batch, but
      there's no automated "expiring soon" alert/report yet — deferred with
      the rest of the alerting/reporting engine to Phase 7.
- [x] Low-stock alerts: `GET /inventory/ingredients/low-stock` + a "Low
      stock" badge on the Ingredients page. No push/email notification yet
      (Phase 7 territory, same as expiry alerts).
- [ ] Procurement: vendor quotations, purchase requests, vendor invoices,
      payment tracking, supplier performance — **deferred**, not started
      this session (the user's ask was scoped to inventory & store
      management specifically; procurement-depth is its own real chunk of
      work, tracked here rather than half-built).

### Phase 5 — Delivery + Online/QR ordering

- [ ] Delivery zones/charges, delivery staff, order assignment, live
      status, ETA, delivery history
- [ ] Full QR ordering: place order, customize items, request waiter,
      request bill, track status — from the table
- [ ] Online ordering surfaces: website, click & collect, scheduled orders

### Phase 6 — Staff, Payroll, Accounting, Multi-branch

- [ ] Employee records, attendance, shift scheduling, leave, tip
      distribution, performance reports
- [ ] Payroll
- [ ] Accounting: sales ledger, expenses/income, cash flow, P&L, balance
      sheet, GST reports, bank reconciliation, daily cash closing, petty
      cash, expense approvals, budgets
- [ ] Branch management: multi-outlet, centralized reporting, central
      inventory, branch stock transfer, unified customer DB, branch-level
      sync agent (see `ARCHITECTURE.md` offline/sync model)

### Phase 7 — Reporting engine, Marketing, Maintenance, Documents

- [ ] Full reports catalog (sales/daily/monthly/annual/tax/inventory/
      profit/food-cost/waste/kitchen-perf/waiter-perf/table-turnover/
      popular-items/slow-movers/customer/loyalty/reservation/delivery/
      payment) — filterable, CSV/PDF/Excel export, print, scheduled email
- [ ] Analytics dashboards: food cost analysis, inventory valuation, peak
      hours, retention, margins, heat maps
- [ ] Marketing: coupons, promotions, happy hours, SMS/email/WhatsApp
      campaigns
- [ ] Maintenance: equipment tracking, service schedules, requests, AMC
- [ ] Documents: digital invoices, purchase docs, contracts, recipes, SOPs

### Phase 8 — Hardening, integrations, packaging

- [ ] Hardware: thermal/kitchen/label printers, cash drawer, barcode/QR
      scanner, customer display, weighing scale, KDS screens — reuse
      `nodedr-pos`'s USB/ESC-POS transport lessons directly
- [ ] Payment gateway, SMS, email, WhatsApp, accounting-software,
      food-delivery-platform integrations
- [ ] 2FA, full audit log, backup/restore utilities
- [ ] SQLite deployment variant (driver-adapter build) for micro single-till
      operators who don't want Postgres — see `ARCHITECTURE.md`
- [ ] GraphQL API (additive, alongside REST)
- [ ] Docker/Windows/Linux installer packaging (mirror `nodedr-pos`'s
      `packaging/` approach), CI/CD release pipeline
- [ ] Automated test suite depth pass (unit + integration + e2e), OpenAPI
      docs finalized, user/installation documentation
- [ ] Full accessibility (`accesslint` audit) + performance pass against
      stated targets (startup <5s, order create <100ms, search <200ms,
      10k+ menu items, 500+ tables, 100+ concurrent staff, millions of
      historical orders)

---

## Explicitly deferred / not guessed

Same judgment call `nodedr-pos` made on large government reference datasets
(HSN/PIN/IFSC): anything requiring a large, frequently-revised external
dataset gets a documented import path, not a fabricated snapshot, when we
reach it (tax code masters, delivery-platform rate cards, etc.).

**Phase 4 scope cuts (2026-08-04):**
- **Unit conversion.** Each `Ingredient` has one base unit used everywhere
  (recipe, PO, GRN, stock). A real conversion engine — buy a 25kg bag,
  stock and recipe in kg — is real, non-trivial modeling work (conversion
  factors can be ingredient-specific and sometimes non-linear, e.g. a dozen
  of a piece-counted item vs. a weight-based one) that would have doubled
  the schema surface for this pass. Revisit when a real recipe needs it.
- **Stock transfers.** Deferred to Phase 6 alongside multi-branch, since a
  transfer needs two real branches to mean anything.
- **Expiry/low-stock alerting (push/email/report).** The *data* is
  captured now (`expiryDate` per batch, `reorderLevel` per ingredient,
  `GET /ingredients/low-stock`) — an actual notification/report layer is
  Phase 7 territory alongside the rest of the reporting engine, not
  something to bolt on ad hoc here.

## Session log

- **2026-08-04 (later same day)**: Automatic ingredient deduction on order
  checkout — the one Phase 4 item deferred earlier that day, picked up as
  "next feature" once the core landed.

  **Design decisions made (this was the actual work, not the wiring):**
  1. **Never blocks the sale.** `consumeStock(..., allowNegative: true)` —
     if modeled recipe demand exceeds available batches, it deducts what's
     there and lets `Ingredient.currentStock` go negative rather than
     throwing. A recipe-modeling gap (most menu items won't have a recipe
     yet) or a mid-service substitution must never be the reason a paid
     food order fails to save; that's a strictly worse outcome than a
     stock figure that needs a stocktake correction later. Waste logging
     keeps the opposite behavior (`allowNegative: false`, blocks) since it
     has no such urgency — same function, opposite defaults, on purpose.
  2. **Combos expand one level.** A combo's own `MenuItem` row essentially
     never carries a direct recipe — deducting only by the combo's
     `menuItemId` would silently skip inventory for every combo sale.
     `InventoryService.deductForOrderItems` expands `isCombo` items via
     `ComboComponent` before resolving recipes. No combos-of-combos in this
     schema (no self-relation on `ComboComponent`), so one level is
     complete, not partial.
  3. **Refunds do not restock.** Deliberately not implemented: if food was
     already prepared and then refunded, the ingredients were still
     consumed — refunding money doesn't un-cook the food. Not a gap, a
     decision.

  **Real refactor, not just new code:** extracted the FIFO batch-consumption
  core (previously duplicated inline in `WasteService`) into
  `StockService.consumeStock`, shared by both waste logging and order
  deduction now. Caught and fixed a real latent bug while doing it: the
  pre-refactor `WasteService`/`StockService.adjustStock` both read
  `Ingredient.currentStock` in a plain query *before* opening the
  `$transaction`, then used that stale snapshot to compute the new value
  inside it — under concurrent requests against the same ingredient,
  Postgres's default READ COMMITTED isolation doesn't protect against a
  lost update there (two concurrent waste-logs could both read the same
  starting stock and the second one to commit silently overwrites the
  first's deduction). Fixed by moving the read to be the first statement
  *inside* the transaction in both places — the same discipline
  `orders.service.ts`'s loyalty-point redemption already used (re-read the
  mutable balance inside the transaction, not before it), just not yet
  applied to the inventory module when it was first built hours earlier.

  **Verified numerically via curl, real scenarios, real orders:** ordering
  2× a menu item with a 0.2kg recipe line against 3kg of stock landed
  stock at exactly 2.6kg; ordering enough of the same item to demand more
  than what remained (20× against 2.6kg) still returned `201` and correctly
  drove stock to exactly -1.4 instead of blocking; an order for an item
  with zero recipe lines checked out cleanly with no errors; a combo built
  live for this test (1× recipe-bearing item + 1× plain item) correctly
  deducted through to the component's recipe on checkout, landing stock at
  exactly the expected value. Also caught and killed an orphaned `nest
  start` process left running from earlier the same session, squatting
  port 4001 — same "check what's actually bound to the port" lesson
  `nodedr-pos`'s memory already recorded once.

- **2026-08-04**: Phase 4 core (Inventory & Store Management) — ingredients,
  recipe costing, suppliers, purchase orders, GRN, batch/lot, waste. Scoped
  to what the user asked for; procurement depth and the items above are
  deferred, not silently dropped.

  **What got built:** Prisma models (`Ingredient`, `RecipeIngredient`,
  `Supplier`, `PurchaseOrder`/`PurchaseOrderItem`, `GoodsReceipt`/
  `GoodsReceiptItem`, `StockBatch`, `StockMovement`, `WasteLog`) plus their
  Zod DTOs in `packages/types/src/inventory.ts`; a NestJS `inventory` module
  (`InventoryService` for ingredients/suppliers/recipe costing,
  `PurchaseOrdersService`, `GoodsReceiptsService`, `WasteService`,
  `StockService` for adjustments/ledger reads) behind the already-seeded
  `inventory.manage` permission; frontend at `/inventory` (tabs for
  Ingredients/Suppliers/Purchase Orders/Waste), a PO detail page with a
  receive-against-PO dialog that pre-fills outstanding quantities.

  **Costing/stock discipline (the actual hard part):** weighted-average
  cost, recomputed on every GRN (`newCost = ((oldStock*oldCost) +
  (recvQty*recvCost)) / (oldStock+recvQty)`), and FIFO waste consumption
  (oldest `StockBatch` first, each batch's own cost carried into the waste
  log — not a blended average). Every cached running total (`Ingredient.
  currentStock`/`costPerUnit`, `PurchaseOrderItem.quantityReceived`) is
  updated via a transactional read-then-`set`, never a DB `increment` —
  the `nodedr-pos` float-drift lesson, applied from the start instead of
  rediscovered later. Verified numerically end-to-end via curl before any
  UI existed for it (see the schema's own inline comment and this session's
  transcript): a 10kg@₹300 GRN then a 5kg@₹360 GRN landed the ingredient at
  exactly ₹320/kg (the correct weighted average); a 0.2kg recipe line at
  that cost priced the menu item at exactly ₹64.00; wasting 12kg correctly
  drained the first batch (10kg@300) fully and 2kg from the second
  (@360), leaving 3kg remaining and the ingredient at exactly 3kg stock;
  over-wasting past available stock correctly 400'd instead of going
  negative.

  **Real bugs/gotchas caught this session:**
  1. `apps/backend/.env`'s `DATABASE_URL` had a stale password
     (`nodedr_dev_pw`) that didn't match root `.env`'s actual
     `POSTGRES_PASSWORD` (`change-me`, which is what the running Postgres
     volume was actually initialized with) — local migrations failed with
     an auth error until traced and fixed. Pre-existing drift between the
     two env files, not introduced this session, but worth knowing about
     if migrations mysteriously fail with valid-looking credentials again.
  2. Root `docker-compose.yml` deliberately doesn't publish Postgres to the
     host (only `expose:`, for security) — local `prisma migrate dev`
     needs host access, so a gitignored `docker-compose.override.yml`
     (now in `.gitignore`) adds the port mapping locally without touching
     the committed, intentionally-locked-down compose file.
  3. Same-value-for-two-fields TypeScript inference gotcha: `let
     purchaseOrder = null` infers type `null` forever, not
     `PurchaseOrderWithItems | null` — needed an explicit
     `Prisma.PurchaseOrderGetPayload<{...}>` type annotation. Cheap to miss,
     caught immediately by `tsc`, worth remembering for the next
     conditionally-fetched Prisma relation.

- **2026-08-03**: Repo created from scratch. Planning docs written first
  (`PROJECT.md`/`ARCHITECTURE.md`/`ROADMAP.md`/`DESIGN_SYSTEM.md`), then
  Phase 0 + all of Phase 1 built and verified in the same session — this
  entry is intentionally detailed since it's the only session so far and a
  future session needs the full picture, not just checkboxes.

  **What got built:** pnpm/Turborepo monorepo; `packages/types` (Zod DTOs +
  permission list, single source of truth for both apps); NestJS backend
  with auth (JWT httpOnly cookie + PIN), a combined `@Auth('permission')`
  guard decorator, and modules for menu/tables/orders/kds/dashboard/
  branches; a `ZodValidationPipe` that had to be fixed to only validate
  `@Body()` (Nest's `@UsePipes()` runs a pipe against *every* parameter,
  including `@Query()` strings, which isn't obvious until a query param gets
  fed into a schema expecting the whole body object); server-authoritative
  pricing (`orders/pricing.ts`) built with the `nodedr-pos` GST-inclusive
  lesson in mind from the start, verified numerically rather than assumed;
  Socket.IO realtime gateway (branch-room push for KOT/table/order events).
  Frontend: Next.js + shadcn/ui (Base UI, not Radix — its trigger components
  take a `render` prop, not `asChild`, and render their own `<button>`, so
  don't nest another button inside one); TanStack Query hooks per domain;
  full Phase 1 UI (login, dashboard, menu, tables, POS, KDS).

  **Real bugs caught by actually running things, not just building:**
  1. The Zod-pipe-validates-every-param issue above (order creation failed
     with a confusing "expected object, received string" until traced to
     `branchId` being run through the body schema).
  2. React's compiler-era ESLint rules (`react-hooks/set-state-in-effect`,
     `react-hooks/purity` — same family as the `nodedr-pos` `react-hooks/refs`
     issue noted in `[[feedback_nextjs_agents_md]]`) flagged three spots:
     calling `Date.now()` during render in a KDS timer hook (fixed by only
     computing it inside the interval callback), and two "derive state from
     an effect" anti-patterns (modifier-picker defaults, branch
     auto-selection) — both fixed by deriving state during render (a keyed
     child component with a lazy `useState` initializer; a `useMemo` derived
     value) instead of `useEffect` + `setState`. **Recurring lesson for this
     stack:** if new code needs "initialize state from a prop/query result
     that's already available at render time," reach for a lazy initializer
     or `useMemo` first — an effect is for synchronizing with a genuinely
     external system (a clock, a subscription), not for copying already-
     available data into state a tick later.
  3. **Two Docker packaging bugs, only caught by actually running
     `docker compose up` end-to-end** (build succeeding is not sufficient
     evidence — same lesson `nodedr-pos` learned about Prisma/Docker): the
     backend's runtime stage flattened everything to `/app`, which silently
     breaks pnpm's per-workspace `node_modules/.bin/*` symlinks (they're
     relative paths back into the root `.pnpm` store) — `npx prisma migrate
     deploy` then can't find the local `prisma` binary and tries to fetch an
     arbitrary "latest" from the registry instead. Fixed by keeping the
     runtime image's directory depth identical to the workspace
     (`/repo/apps/backend`, `/repo/packages/types`, `/repo/node_modules`),
     not flattening. Same root cause bit `packages/types`' own dependency
     (`zod`) a second time — its `node_modules` (containing the `zod`
     symlink) also needed to be copied alongside its `dist`. **Standing
     lesson for any future Dockerfile touching this monorepo:** when
     packaging a pnpm workspace member for a container, preserve the
     workspace's relative directory structure end to end, or copy each
     package's own `node_modules` explicitly — don't assume a flattened
     `COPY --from=builder /repo/node_modules ./node_modules` is enough.
  4. Test-data hygiene: iterative Playwright runs against the same dev
     database left two abandoned OPEN orders occupying tables, which then
     made a later automated test's "click the first table option" fail
     because that table was (correctly) disabled — not a product bug, just
     accumulated test state. Settled both via the checkout API before
     finishing rather than leaving stray open orders in the seeded demo.

  **Verified, not just written:** full login→menu→tables→POS→KDS
  click-through via Playwright (screenshots at desktop/mobile/dark-mode);
  pricing verified numerically (GST backed out correctly, discount lands on
  the exact rupee); real `docker compose up` with real Postgres, backend,
  and web containers talking to each other, login + dashboard working
  through the web container's `/api` proxy exactly as a real deployment
  would use it.

  **Not done, explicitly deferred (see inline Phase 0/1 notes above):** CI
  workflow, floor drag-to-reposition UI, KDS per-station column view,
  receipt HTML/PDF rendering, dashboard realtime (still polling).

- **2026-08-03 (same day, continued session): Phase 2 — kitchen depth +
  reservations/waitlist/QR.** Added `Reservation` and `WaitlistEntry` models
  (migration `add_reservations_waitlist`); reused `Table.qrToken` (already
  in the Phase 1 schema, unused until now) for QR generation. Backend:
  `ReservationsModule`, `WaitlistModule`, unauthenticated `PublicModule`
  (`GET /public/menu/:qrToken`), plus reprint/priority/performance additions
  to the existing orders/KDS modules. Frontend: Reservations page, a
  Waitlist panel embedded in the Tables page, a QR-code dialog on each
  table tile (`qrcode.react`), the public `/order/[qrToken]` menu view, and
  priority/reprint controls + a performance widget on the KDS board.

  **Verified, not just written:** full Playwright click-through (create
  reservation → change status → confirm table-status side effect; add to
  waitlist → seat → table occupied; generate QR → scan-equivalent visit to
  `/order/[qrToken]` with both a valid and an invalid token; KDS priority
  star + reprint button + performance widget all rendering real data from
  earlier curl-driven test orders) — screenshots taken at each step,
  including one dark-mode pass on the new Reservations page. Backend
  behavior (table status RESERVED→OCCUPIED→AVAILABLE through the
  reservation lifecycle, waitlist seat marking a table OCCUPIED) verified
  via curl against the running Postgres-backed API before any frontend
  existed for it, same discipline as Phase 1.

  **Nothing new broke the recurring lessons from Phase 1** (Zod pipe
  body-only scoping, React derived-state-in-effect) — this phase's code
  was written with those already in mind, not rediscovered. One new
  Prisma-specific gotcha: `Table` has no direct `branchId` column (it's
  reached via `Floor.branchId`), so `rotateQrToken`'s tenancy check needed
  `where: { id, floor: { branchId } }`, not a flat `{ id, branchId }` —
  caught immediately by `tsc`, not at runtime.

  **Not done, explicitly deferred (see inline Phase 2 notes above):**
  reservation reminder notifications (needs Phase 8 SMS/email/WhatsApp),
  deposit collection UI (field exists, no payment flow), QR ordering
  beyond view-only (Phase 5 scope).

- **2026-08-03 (same day, third session): Phase 3 — CRM, loyalty, gift
  cards, combos, billing depth.** New Prisma models: expanded `Customer`
  (address/birthday/anniversary/allergies/notes/loyaltyPoints/
  walletBalance), `GiftCard` + `GiftCardRedemption`, `ComboComponent`,
  `Refund`; `Order` gained `tipAmount`, `loyaltyPointsRedeemed`,
  `loyaltyDiscountAmount` (migration `add_crm_loyalty_giftcards_combos`).
  Backend: `CustomersModule`, `GiftCardsModule`, combo-composition methods
  folded into the existing `MenuService`/`MenuController` (not a separate
  module — it's menu configuration), and a substantial rewrite of
  `OrdersService.checkout()` to layer in tip/loyalty-redemption/
  gift-card-payment/loyalty-earning inside one transaction, plus new
  `refund()` and `mergeOrders()` methods. Frontend: a Customers list +
  profile page, a customer search-and-attach picker wired into the POS
  cart, loyalty/gift-card/tip/split-bill-calculator fields added to the
  checkout panel, a combo-builder dialog in Menu management (a "Layers"
  icon per item row, highlighted when `isCombo`), a refund action on the
  dashboard's recent-transactions list, and a "merge another table's bill
  here" action on occupied table tiles.

  **Verified, not just written:** every new backend capability hit with
  curl first (loyalty earn on a ₹480 order → exactly 4 points at the
  stated rate; redeeming those 4 points on a ₹90 order → exactly ₹86 due
  and balance back to 0; a ₹200 gift card correctly only partially
  covering a ₹220 order, then fully draining across two payment sources;
  a refund correctly capped at "total minus prior refunds," rejecting an
  over-refund attempt; merging two open orders producing the exact summed
  subtotal, cancelling the source order, and releasing its table) *before*
  any frontend UI existed for it — same discipline as Phase 1/2. Then the
  same flows again through Playwright against the real UI (customer
  create → profile page, combo save reflected live in the Layers-icon
  highlight, refund dialog → toast → dashboard revenue update, merge
  dialog → correct target/source table statuses).

  **New recurring-lesson hit, not a new class of bug:** the
  `react-hooks/set-state-in-effect` issue from Phase 1/2 recurred a third
  time in the combo-builder dialog (initializing local editable `rows`
  state from a `useComboComponents` query result). Fixed with the same
  established pattern — a child component keyed by the parent item, given
  a lazy `useState` initializer once the query result is available, rather
  than an effect copying query data into state. Worth calling out
  specifically because it's now happened enough times in this codebase
  that it should be the *default* instinct for "seed local state from
  already-fetched data," not something to rediscover per component.

  **Deliberate scope cuts, decided and documented, not silently
  skipped:** combo components are informational/kitchen-facing only — no
  automatic ingredient stock deduction (needs Phase 4's inventory system
  to exist first); "split bill" is a display-only equal-share calculator,
  not a system that produces separate per-guest checks (the Order model
  finalizes as one unit; real bill-splitting needs a data-model change,
  not a quick add); loyalty program is a single fixed earn/redeem rate,
  not yet configurable per restaurant.
