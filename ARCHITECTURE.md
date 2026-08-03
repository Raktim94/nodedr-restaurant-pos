# Architecture

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | 20 product domains, shared design system + types across `web`/`backend`. Turborepo gives cached/parallel builds without Nx's heavier config surface. |
| Backend | **NestJS** (TypeScript) | This is the one deliberate deviation from `nodedr-pos`'s plain Express. A 20-module, RBAC-everywhere, plugin-ready system needs real dependency injection, a module boundary per domain, decorator-based guards for permissions, and first-class WebSocket + OpenAPI support out of the box. Express would work but every one of those becomes hand-rolled infrastructure instead of a framework primitive. GraphQL (future, per spec) is also a `@nestjs/graphql` module away without a rewrite. |
| ORM / DB | **Prisma**, PostgreSQL primary target | See "Database strategy" below — this is the one place we deviate from the literal brief ("SQLite for single-location") and the reasoning is spelled out, not hand-waved. |
| Realtime | Socket.IO (NestJS gateway) | Table status, KDS ticket updates, and QR-order status push all need server→client push, not polling. One gateway module, namespaced per concern (`/kds`, `/tables`, `/orders`). |
| Frontend | Next.js (App Router) + TypeScript + Tailwind v4 | Matches `nodedr-pos`'s proven frontend stack. App Router gives layouts-per-section (POS vs. back-office vs. KDS vs. public QR-order site) without a separate app per surface. |
| UI components | shadcn/ui (Base UI primitives, not Radix — see `DESIGN_SYSTEM.md`) | Ships as owned source in `packages/ui`, not a black-box dependency — required for the level of visual customization the design bar demands. |
| Data fetching | TanStack Query | Cache + optimistic updates for the "no layout shift, optimistic UI" requirement. |
| Forms | React Hook Form + Zod | Same Zod schemas shared between frontend validation and backend DTOs via `packages/types`. |
| Tables | TanStack Table | Sorting/filtering/virtualization for 10,000+ menu items / 500+ tables / millions of orders — a plain `<table>` map does not scale to the stated performance targets. |
| Charts | Recharts | Proven in `nodedr-pos` already (theme-aware via CSS vars). |
| Drag & drop | dnd-kit | Floor designer (drag/resize/rotate tables) and KDS column drag. |
| i18n | next-intl | Multi-language requirement. |
| Auth | JWT (httpOnly cookie) + PIN quick-switch | Session cookie for a logged-in device/terminal; PIN re-auth for fast staff handoff on a shared till, same UX restaurants actually use. 2FA (TOTP) optional per user, per spec. |
| Containerization | Docker + Docker Compose | Matches `nodedr-pos`; `postgres`, `backend`, `web` services. |

## Why NestJS over the Express pattern `nodedr-pos` uses

`nodedr-pos` is a single-domain app (products, invoices, customers) where
Express + a handful of route files is the right amount of structure. This
project has 20 domains that need to be independently addable, independently
permission-gated, and eventually plugin-loadable. NestJS's module system
*is* that boundary — each domain (`modules/menu`, `modules/inventory`,
`modules/kds`, ...) is a self-contained Nest module with its own
controllers/services/DTOs, wired together at the `AppModule` root. Adding
domain #21 later means adding a module, not threading new route files
through a shared Express app and hoping nothing collides.

## Database strategy: PostgreSQL primary, SQLite honestly scoped

The original brief says "SQLite for single-location, PostgreSQL for
multi-location." In practice, with Prisma, the datasource `provider` is
fixed per schema — supporting both live means either two parallel schemas
(drift risk on every migration) or Prisma's newer driver-adapter pattern
switched by env (real, but adds real complexity to every migration).

**Decision:** build against **PostgreSQL as the single source of truth**
from day one, including for single-location deployments (Postgres in Docker
is trivial to run locally and is not a "cloud" or "internet" dependency —
it's still 100% self-hosted/offline). This buys:
- Real concurrency for the stated 100+ concurrent staff / 500+ tables
  targets (SQLite's single-writer model is a genuine ceiling here, unlike
  in `nodedr-pos`'s single-cashier-terminal retail case).
- JSON columns (modifier snapshots, recipe data), full-text search, and
  window functions used throughout reporting.
- Zero schema fork between single-location and multi-branch — a branch is
  just a `Branch` row; multi-location is the same schema, not a different
  deployment mode.

SQLite support is **not abandoned**, just sequenced honestly: it is a
later-phase deployment target (a `sqlite` Prisma driver-adapter build, same
pattern `nodedr-pos` already validated with `better-sqlite3`) for very small
single-till operators who don't want to run Postgres at all. It is tracked
in `ROADMAP.md` Phase 8, not silently dropped.

## Offline & multi-branch sync model (stated honestly)

"Offline-first" is used precisely here, not as marketing:

- **Single location = offline by construction.** The full stack
  (Postgres + backend + frontend) runs on one local server on the
  restaurant's LAN. Terminals are just browser tabs on that LAN. There is no
  internet dependency for the restaurant to keep operating — order taking,
  billing, KDS, printing all work with the WAN cable unplugged. This is the
  same model `nodedr-pos` already ships and is fully honest.
- **What we do NOT claim:** a single terminal continuing to take orders
  *while disconnected from its own local server* (true multi-writer
  offline with client-side conflict resolution/CRDTs). That is a
  fundamentally different, much larger engineering problem (merge
  conflicts on table state, stock counts, KOT ordering) and is out of scope
  unless the user explicitly asks for it later — building it silently and
  getting the conflict resolution wrong would be worse than not having it.
- **Multi-branch sync (cloud aggregation):** each branch runs its own local
  stack and is authoritative for its own transactional data. A branch-level
  sync agent queues completed transactions (orders, stock movements,
  payments) and pushes them to a central reporting/aggregation instance
  when internet connectivity is available — eventually consistent,
  branch-first. Central branch management (module 12) reads from this
  aggregate; it does not write back transactional data into a branch.
  Tracked in `ROADMAP.md` Phase 6.

## Monorepo layout

```
nodedr-restaurant-pos/
├── apps/
│   ├── backend/        # NestJS API — REST (versioned /api/v1), Swagger, Socket.IO gateways
│   └── web/             # Next.js — back-office, POS, KDS, public QR-ordering site (route groups)
├── packages/
│   └── types/            # shared Zod schemas + TS types (DTOs) used by both apps
│   # `ui`/`config` packages were planned here but not split out yet — the
│   # design system currently lives directly in apps/web/components/ui
│   # (standard shadcn location) since there's only one frontend app so far;
│   # extract to a shared package once a second app needs the same
│   # components. See ROADMAP.md Phase 0 notes.
├── docker/
├── docs/
├── PROJECT.md
├── ARCHITECTURE.md
├── ROADMAP.md
└── DESIGN_SYSTEM.md
```

## Reused from `nodedr-pos` (patterns, not code copy-paste)

- JWT httpOnly cookie session pattern + secret-in-volume bootstrap.
- `pdfkit` HTML+PDF receipt rendering approach (vector-drawn separator
  lines, explicit column-gap padding — both learned the hard way, see
  `nodedr-pos` memory).
- ESC/POS USB printing: kernel-driver detach + usblp char-device-first
  transport (`/dev/usb/lp0`) as the primary path, libusb class-7 as
  fallback only.
- Currency/tax rounding discipline: round2 + `set`, never DB `increment`,
  on any running balance.
- Docker Compose service-split (only the component needing device
  passthrough gets elevated privileges).
