# Nodedr Restaurant

Offline-first Restaurant Management System — POS, tables, kitchen display,
reservations, CRM/loyalty, and more. Not a retail POS bolted onto a
restaurant; purpose-built for dine-in, takeaway, and kitchen operations.

Start with [`PROJECT.md`](./PROJECT.md) for the full vision and status,
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for tech-stack decisions,
[`ROADMAP.md`](./ROADMAP.md) for the phased build plan / living TODO, and
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the visual language.

## Screenshots

| | |
|---|---|
| ![Dashboard](docs/screenshots/dashboard-light.png) | ![Dashboard (dark)](docs/screenshots/dashboard-dark.png) |
| Dashboard — light | Dashboard — dark |
| ![Point of Sale](docs/screenshots/pos-light.png) | ![Kitchen Display](docs/screenshots/kds-light.png) |
| Point of Sale | Kitchen Display — priority ticket, live timers |
| ![Tables](docs/screenshots/tables-light.png) | ![Reservations](docs/screenshots/reservations-light.png) |
| Tables — floor view + waitlist | Reservations |
| ![Customers](docs/screenshots/customers-light.png) | ![Menu](docs/screenshots/menu-light.png) |
| Customers — CRM + loyalty | Menu management — combo builder |

<details>
<summary>Mobile (390px)</summary>

![Dashboard on mobile](docs/screenshots/dashboard-mobile.png)

</details>

## Stack

NestJS (API) + PostgreSQL/Prisma + Next.js (web) + Socket.IO (realtime) in a
pnpm/Turborepo monorepo. See `ARCHITECTURE.md` for the full rationale.

## Quick start (Docker)

```bash
cp .env.example .env        # edit JWT_SECRET / POSTGRES_PASSWORD for anything beyond local dev
docker compose up -d --build
docker exec nodedr-restaurant-backend npx ts-node prisma/seed.ts   # first run only — demo data + login
```

Open http://localhost:1995 and sign in with `owner@demo.local` /
`Password123!` (seeded demo account — change or remove before real use).

Backend API + Swagger docs are reachable only through the web app's `/api`
proxy (same pattern as `nodedr-pos`), not published directly to the host.

## Quick start (local dev, no Docker for the apps)

Requires Node 22+, pnpm, and a local Postgres (or run just the `postgres`
service from Docker Compose: `docker compose up -d postgres`).

```bash
pnpm install
cp apps/backend/.env.example apps/backend/.env   # point DATABASE_URL at your Postgres
pnpm --filter @nodedr-restaurant/types build
cd apps/backend && npx prisma migrate dev && npx ts-node prisma/seed.ts && cd ../..
pnpm dev   # runs backend (:4001) and web (:1995) together via Turborepo
```

## Monorepo layout

```
apps/backend    NestJS API (REST /api/v1, Swagger at /api/docs, Socket.IO)
apps/web        Next.js — back-office, POS, KDS, public QR menu view
packages/types  Shared Zod schemas / TS types used by both apps
```

## Where things stand

Phases 0-3 are complete and verified end-to-end: auth + RBAC, menu
management (incl. combo meals), floor/table view with waitlist and merge,
reservations, table QR codes with a public read-only menu view, POS
order-taking with modifiers, KOT generation routed to kitchen stations
(with priority/reprint/performance reporting), a live Kitchen Display
Screen, billing + checkout (tips, split-bill calculator, gift cards,
loyalty points, refunds), customer CRM, and a real-time dashboard. See
`ROADMAP.md` for what's next (inventory/procurement, delivery, accounting,
multi-branch, and the rest of the 20-module scope) and its inline notes on
every scope cut made along the way.

## Development notes

- Server-authoritative pricing: menu prices are tax-inclusive; GST/VAT is
  backed out, never added on top. See `apps/backend/src/modules/orders/pricing.ts`.
- Any running money balance (loyalty points, gift card balance, wallet
  credit) is updated via a rounded read-modify-write `set`, never a DB-side
  `increment` — the latter drifts on Float columns over many transactions.
- Shared validation: Zod schemas in `packages/types` drive both the NestJS
  `ZodValidationPipe` and the frontend's `react-hook-form` resolvers — one
  schema per DTO, not duplicated.
- Realtime: `RealtimeGateway` (Socket.IO) pushes KOT/table/order events into
  a per-branch room; the frontend's `useRealtime` hook invalidates the
  matching TanStack Query caches instead of polling.
