# Nodedr Restaurant — Master Project Document

> Start here. This file is the source of truth for scope, status, and decisions.
> Companion docs: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (tech stack + why),
> [`ROADMAP.md`](./ROADMAP.md) (phased build plan / living TODO),
> [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) (visual language, tokens, components).

## What this is

**Nodedr Restaurant** is a purpose-built, offline-first Restaurant Management
System — not a retail POS reused for restaurants. Target venues: restaurants,
cafés, coffee shops, bakeries, fast food, fine dining, bars, food courts,
cloud kitchens, and multi-branch chains.

It is a sister project to [`nodedr-pos`](../nodedr-pos) (the retail shop
POS), sharing its self-hosted/Docker/no-subscription philosophy and reusing
*proven patterns* from it (auth session model, PDF/HTML receipt rendering,
ESC/POS + USB printing lessons, currency/tax-rounding discipline, ISO
packaging approach) — but it is architecturally a new codebase. Retail
shop billing and restaurant floor/kitchen/reservation operations are
different enough domains that forcing one schema to serve both would have
compromised both.

## Product principles (non-negotiable)

1. **Offline-first / self-hosted.** A single branch must run entirely on a
   local LAN server with zero internet dependency once installed. See
   "Offline & multi-branch sync model" in `ARCHITECTURE.md` for exactly what
   this promises and where the honest limits are (this is stated explicitly
   because "offline-first" is oversold industry-wide — we will not do that
   here).
2. **Premium, not "POS-ugly."** Every screen must read like it belongs next
   to Stripe, Linear, Notion, Vercel, Shopify Admin — see `DESIGN_SYSTEM.md`.
   This is a real acceptance bar, not marketing copy: if a screen looks like
   a generic admin template, it's not done.
3. **RBAC everywhere.** Every action gated by a granular, individually
   toggleable permission — never a hardcoded role check in business logic.
4. **Modular / plugin-ready.** Twenty product domains (see below) must be
   able to evolve independently. This is *why* the backend is NestJS rather
   than a flat Express app — see `ARCHITECTURE.md`.
5. **Server-authoritative money.** All pricing, tax, discount, loyalty math
   computed server-side, never trusted from the client — the same rule
   `nodedr-pos` learned the hard way (see its memory: GST-inclusive pricing
   bug, float-increment drift bug). Every new money-touching feature here
   gets the same discipline from day one: round with a helper, `set` not
   `increment` on running balances, verify numerically before calling it done.

## Full scope (all 20 modules, target end-state)

This is the complete vision from the original brief. **We are not building
all of this in one pass** — `ROADMAP.md` sequences it into phases. Treat this
list as the north star, not this week's task list.

1. POS & Billing — dine-in/takeaway/delivery, split/merge bills, GST/VAT,
   discounts, gift cards, tips, multi-payment, refunds
2. Table & Reservation Management — visual floor plan, booking, waitlist,
   QR table ordering, table transfer, guest management
3. Kitchen Management (KDS) — display, KOTs, multi-station routing, prep
   tracking, performance
4. Menu Management — categories, modifier groups, combos, recipe linking,
   seasonal menus, availability scheduling
5. Inventory & Store Management — ingredients, recipe costing, POs,
   suppliers, GRN, transfers, waste, expiry, batch/lot, auto-deduction
6. Procurement — vendor quotations, purchase requests/orders, invoices,
   payment tracking, supplier performance
7. CRM — profiles, loyalty points, memberships, gift vouchers, birthday
   campaigns, feedback, visit history
8. Staff Management — records, attendance, shift scheduling, payroll, leave,
   performance, tip distribution, role permissions
9. Accounting — sales ledger, expenses, income, cash flow, P&L, balance
   sheet, GST reports, bank reconciliation
10. Delivery Management — executives, routing, tracking, 3rd-party
    integration, delivery charges
11. Online Ordering — website, mobile, QR, click & collect, scheduled orders
12. Branch Management — multi-outlet, centralized reporting/inventory,
    branch transfer, unified customer DB
13. Analytics — sales dashboard, food cost, inventory valuation, peak hours,
    best-sellers, staff performance, retention, margins
14. Marketing — coupons, promotions, combos, happy hours, SMS/email/WhatsApp
    campaigns
15. Finance — daily cash closing, petty cash, expense approvals, budgets
16. Maintenance — equipment tracking, service schedules, requests, AMC
17. Documents — digital invoices, purchase docs, contracts, recipes, SOPs
18. Security — RBAC, audit logs, backup/restore, activity history, 2FA
19. Integrations — payment gateways, SMS, email, WhatsApp, accounting
    software, delivery platforms, barcode/thermal printers, kitchen displays
20. Admin Panel — global settings, taxes, currencies, business hours, branch
    config, users, feature flags, backup management

Full field-level detail for every module (every entity's columns, every
status enum, every report type) lives in `ROADMAP.md`'s per-phase sections —
this file stays high-level on purpose so it doesn't rot as details get
refined during implementation.

## Status

**Phase 0 and Phase 1 are complete and verified** (auth/RBAC, menu, tables,
POS ordering with modifiers, KOT generation, live KDS, billing/checkout,
dashboard — see `ROADMAP.md` for exactly what's done vs. scope-cut vs.
still ahead, including a few small fast-follows noted inline). Docker
Compose stack builds and runs for real. Next up: Phase 2 (kitchen depth +
reservations) and the CI workflow that didn't make it into session 1. This
section is updated at the end of every work session; if it looks stale,
trust `git log` and `ROADMAP.md`'s checkboxes over prose here.

## How to resume work on this project

1. Read this file, then `ARCHITECTURE.md`, then the "Current phase" section
   at the top of `ROADMAP.md`. Do not re-derive decisions already recorded
   here — update them if they've changed, don't silently re-litigate.
2. Check `ROADMAP.md` checkboxes for what's actually done vs. planned.
3. Check `git log` — this doc is updated per-session but git is the ground
   truth for what code exists.
