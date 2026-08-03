# Roadmap / Living TODO

Checkboxes are the actual status — trust these (and `git log`) over prose in
`PROJECT.md`. Update this file at the end of every work session.

## Current phase: 3 complete → starting Phase 4

Started 2026-08-03. Phases 0-3 all finished and verified the same day (real
Docker containers, real Postgres, full click-through each phase). Phase 3
(CRM/loyalty/gift cards/combos/billing depth) is the latest — see Session
log.

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
      payment record. **Scope cut:** no receipt HTML/PDF rendering yet
      (`nodedr-pos`'s pdfkit approach is the reference for when this lands —
      Phase 8 hardware/printing item covers it); checkout today ends in an
      on-screen "paid" confirmation, not a printable receipt.
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

- [ ] Ingredient-based inventory: raw materials, units + unit conversion,
      recipes (menu item → ingredient quantities), automatic deduction on
      order
- [ ] Purchase orders, supplier management, goods received (GRN), stock
      transfers, stock adjustments
- [ ] Waste recording, expiry tracking, batch/lot numbers, low-stock alerts
- [ ] Procurement: vendor quotations, purchase requests, vendor invoices,
      payment tracking, supplier performance

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

## Session log

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
