# Roadmap / Living TODO

Checkboxes are the actual status — trust these (and `git log`) over prose in
`PROJECT.md`. Update this file at the end of every work session.

## Current phase: 0 → 1 (Foundation + first vertical slice)

Started 2026-08-03.

---

### Phase 0 — Foundation

- [x] Planning docs (`PROJECT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DESIGN_SYSTEM.md`)
- [ ] Monorepo scaffold (pnpm workspaces + Turborepo, `packages/config` shared eslint/tsconfig)
- [ ] `packages/types` — shared Zod schemas/DTOs
- [ ] `apps/backend` NestJS skeleton — module-per-domain folders (even if stubbed), Swagger at `/api/docs`, versioned routes (`/api/v1`)
- [ ] Prisma schema v1 (auth/RBAC + menu + tables + orders core — see Phase 1 entities below), PostgreSQL
- [ ] Auth: JWT httpOnly cookie login, PIN quick-switch, session bootstrap
- [ ] RBAC: Role + Permission tables, Nest guard/decorator (`@RequirePermission('orders.create')`), full permission list wired (see Phase 0 permission list below) even before every module exists
- [ ] `apps/web` Next.js skeleton — App Router route groups: `(auth)`, `(dashboard)` back-office, `(pos)`, `(kds)`, `(order)` public QR site
- [ ] `packages/ui` design system foundation — Tailwind theme tokens, shadcn init, AppShell (sidebar+topnav, responsive drawer below `lg`), dark/light via `next-themes`
- [ ] Docker Compose (`postgres`, `backend`, `web`), `.env.example`, root README
- [ ] Base CI (lint+typecheck+build on push) — `.github/workflows`

**Permission list (seed data, granular, matches spec):** view_sales,
create_orders, edit_orders, cancel_orders, apply_discounts, process_refunds,
print_bills, manage_tables, manage_menu, manage_inventory, access_reports,
manage_users, view_financial_reports, export_data — extended per-module as
later phases add domains. Roles seeded: Owner, Administrator, Restaurant
Manager, Cashier, Waiter, Kitchen Staff, Chef, Bartender, Delivery Staff,
Accountant, Inventory Manager — each a named bundle of permissions, but
every permission independently toggleable per role (never hardcoded).

### Phase 1 — Core vertical slice (dine-in POS, end to end)

Goal: a real restaurant could open a table, take an order with modifiers,
send a KOT to a kitchen station, see it on a KDS, mark it ready/served, bill
and pay, print/download a receipt — today's session target.

- [ ] **Menu management**: categories (unlimited, nested not required v1),
      items (name, SKU, price, tax rate, category, kitchen station, prep
      time, veg/non-veg/vegan/spicy-level, image, available-time window),
      modifier groups + modifiers (price adjustment, default selection, max
      selection), premium data-grid CRUD UI
- [ ] **Floor & table management**: floors (Ground/First/Rooftop/... —
      user-defined), visual floor designer (drag/resize, dnd-kit), table
      entity (number, name, capacity, status enum: available/occupied/
      reserved/cleaning/out_of_service, assigned waiter, notes), open/close/
      merge/transfer table actions
- [ ] **POS order screen**: dine-in + takeaway order types, cart with
      modifier selection, live tax/discount preview (server-authoritative
      on submit — client preview only), search + touch-friendly product
      grid, keyboard shortcuts
- [ ] **KOT**: on order submit, generate KOT(s) split by kitchen station,
      status flow new→accepted→preparing→ready→served→cancelled
- [ ] **KDS**: per-station ticket columns, timers, color-coded age,
      accept/bump actions, realtime via Socket.IO (no polling)
- [ ] **Billing/checkout**: tax calc (GST/VAT, inclusive-pricing discipline
      per `nodedr-pos` lesson — verify numerically, don't assume), flat/%
      discount, cash/card/UPI payment record, receipt (HTML print +
      PDF download, reusing `nodedr-pos`'s pdfkit vector-rule + column-gap
      lessons)
- [ ] **Dashboard v1**: today's revenue, today's orders, active/occupied/
      reserved tables, kitchen queue counts, recent transactions

### Phase 2 — Kitchen depth + Reservations

- [ ] Kitchen stations as first-class config (name → routes menu items),
      reprint KOT, delay alerts, priority orders, kitchen performance report
- [ ] Reservations: customer name/phone/email, guest count, date/time/
      duration, assigned table, special requests, deposit, status flow
      (reserved/confirmed/arrived/completed/cancelled/no_show), reminder
      notifications
- [ ] Waitlist
- [ ] Table QR generation + public QR ordering read path (view menu, no
      order placement yet — full QR ordering lands Phase 5)

### Phase 3 — CRM + Loyalty + Combos

- [ ] Customer profiles (phone/email/address/birthday/anniversary/
      allergies/notes/order history)
- [ ] Loyalty points (earn/redeem), memberships, gift vouchers
- [ ] Combo meals (bundle pricing, ingredient deduction across bundle)
- [ ] Split/merge bills, gift cards, tips, partial/advance payments, refunds

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

- **2026-08-03**: Repo created. Planning docs written
  (`PROJECT.md`/`ARCHITECTURE.md`/`ROADMAP.md`/`DESIGN_SYSTEM.md`). Starting
  Phase 0 scaffold + Phase 1 vertical slice.
