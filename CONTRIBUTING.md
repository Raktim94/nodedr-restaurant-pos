# Contributing to Nodedr OrderRestro

First off — thank you for considering a contribution. This is a young,
fast-moving project (Phases 0-3 of a 20-module scope are done; see
[`ROADMAP.md`](./ROADMAP.md)), which means two things for you as a
contributor: there's a lot of surface area to help with, and the project
docs are the actual source of truth, updated every session — read them
before you read the code.

This guide covers environment setup, the non-negotiable conventions the
codebase already leans on, and the process for issues/PRs/discussions. If
anything here is out of date, trust [`PROJECT.md`](./PROJECT.md) and
`git log` over this file, and please open a PR fixing the drift.

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Conventions that are not optional](#conventions-that-are-not-optional)
- [Design bar](#design-bar)
- [Making a change](#making-a-change)
- [Commit messages](#commit-messages)
- [Opening a pull request](#opening-a-pull-request)
- [Reporting bugs](#reporting-bugs)
- [Proposing features / architecture changes](#proposing-features--architecture-changes)
- [Questions & discussion](#questions--discussion)

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it. Report unacceptable behavior to
**ranjitraktim5@gmail.com**.

## Maintainers & copyright

See [`MAINTAINERS.md`](./MAINTAINERS.md) — Raktim Ranjit is the lead
maintainer; project copyright is held jointly by
[Nodedr Infotech Private Limited](https://www.nodedr.com/) and Raktim
Ranjit. By submitting a PR, you agree your contribution is licensed under
the same [AGPL-3.0](./LICENSE) as the rest of the project; you retain
copyright on your own contribution.

## Before you start

Read, in this order:

1. [`PROJECT.md`](./PROJECT.md) — what this is, the non-negotiable product
   principles, the full 20-module scope, and current status. This is the
   source of truth; don't silently re-litigate a decision recorded here —
   if you think it's wrong, open a discussion (see below) and update it.
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — tech stack and, more
   importantly, *why* each choice was made (NestJS over Express, Postgres
   over the originally-specced SQLite, the offline/multi-branch sync
   model stated honestly). Reading the rationale saves you from proposing
   something already considered and rejected for a documented reason.
3. [`ROADMAP.md`](./ROADMAP.md) — the phased build plan and living TODO.
   Checkboxes here (and `git log`) are the ground truth for what's
   actually done vs. planned — trust them over prose elsewhere.
4. [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) — visual language, tokens,
   component inventory, and the acceptance bar for UI work ("a screen
   that looks like a generic admin template is not done").

## Development setup

**Prerequisites:** Node.js 22+, [pnpm](https://pnpm.io), Docker (for
Postgres, or the whole stack), and a Postgres instance if not using
Docker for it.

### Option A — full stack via Docker

```bash
git clone https://github.com/Raktim94/nodedr-restaurant-pos.git
cd nodedr-restaurant-pos
cp .env.example .env                 # edit JWT_SECRET / POSTGRES_PASSWORD for anything beyond local dev
docker compose up -d --build
docker exec nodedr-restaurant-backend npx ts-node prisma/seed.ts   # first run only — demo data + login
```

Open <http://localhost:1995> and sign in with `owner@demo.local` /
`Password123!` (seeded demo account — never use this in a real
deployment). The backend API and Swagger docs (`/api/docs`) are reachable
only through the web app's `/api` proxy, matching `nodedr-pos`'s pattern —
they are not published directly to the host.

### Option B — local dev (apps run on the host, Postgres in Docker)

```bash
pnpm install
docker compose up -d postgres                               # just the DB
cp apps/backend/.env.example apps/backend/.env               # point DATABASE_URL at your Postgres
pnpm --filter @nodedr-restaurant/types build
cd apps/backend && npx prisma migrate dev && npx ts-node prisma/seed.ts && cd ../..
pnpm dev   # runs backend (:4001) and web (:1995) together via Turborepo
```

### Before opening a PR, locally run

```bash
pnpm lint
pnpm typecheck
pnpm build
```

There is no CI workflow wired up yet (tracked in `PROJECT.md`/`ROADMAP.md`
— a good first contribution if you want one) — until it lands, a green
local `lint` + `typecheck` + `build` is the actual gate, so run all three
before requesting review.

## Project structure

```
apps/backend    NestJS API — REST (/api/v1), Swagger at /api/docs, Socket.IO gateways
apps/web        Next.js — back-office, POS, KDS, public QR-ordering site
packages/types  Shared Zod schemas / TS types (DTOs) used by both apps
docker/         Container assets
docs/           Screenshots and supplementary docs
```

Each backend domain is its own NestJS module
(`apps/backend/src/modules/<domain>`) with its own controllers, services,
and DTOs, wired together at `AppModule`. Adding a new domain means adding
a module, not threading new routes through a shared app — see
`ARCHITECTURE.md` for why.

## Conventions that are not optional

These are documented, previously-learned-the-hard-way rules (some
inherited from this project's sister repo, `nodedr-pos`, which hit these
bugs in production). PRs that violate them will be asked to change before
merge, regardless of otherwise-good code:

- **Server-authoritative money.** All pricing, tax, discount, and loyalty
  math is computed server-side — never trust a total/amount from the
  client. Menu prices are tax-inclusive; GST/VAT is backed out, never
  added on top (see `apps/backend/src/modules/orders/pricing.ts`).
- **Round, then `set` — never DB-side `increment`.** Any running money
  balance (loyalty points, gift card balance, wallet credit) is updated
  via a rounded read-modify-write `set`. `increment` on a Float column
  drifts over many transactions — this is a real bug this project
  inherited a lesson from, not a style preference.
- **One Zod schema per DTO, shared.** Validation schemas live in
  `packages/types` and drive both the NestJS `ZodValidationPipe` and the
  frontend's `react-hook-form` resolvers. Don't hand-roll a parallel
  frontend-only or backend-only shape for something that already has a
  shared schema.
- **RBAC via decorator, never a hardcoded role check.** Every
  permission-gated action uses `@Auth('permission.key')`
  (JwtAuthGuard + PermissionsGuard combined). If the permission you need
  doesn't exist yet, add it to the seeded permission list — don't branch
  on `user.role === 'owner'` in business logic.
- **Realtime via the gateway + hook, not polling.** `RealtimeGateway`
  (Socket.IO) pushes KOT/table/order events into a per-branch room; the
  frontend's `useRealtime` hook invalidates the matching TanStack Query
  cache. If you need a screen to update live, wire into this pattern
  rather than adding a `setInterval` poll.

## Design bar

This is explicitly not "POS-ugly": every screen is held to the same bar
as Stripe Dashboard, Linear, Notion, Vercel, Shopify Admin — see
`DESIGN_SYSTEM.md` for tokens, type scale, component inventory, and
per-surface notes (POS trades some spaciousness for speed/density on
purpose; KDS type sizes are larger because it's read from across a
kitchen). If a UI contribution looks like a generic admin template, it's
not done yet, regardless of whether it works. WCAG AA is the accessibility
floor — keyboard-navigable everywhere, visible focus states, especially
on POS/KDS screens used under time pressure.

## Making a change

1. Fork the repo and create a branch off `master`:
   `git checkout -b feat/short-description` (or `fix/`, `docs/`, `chore/`
   as appropriate).
2. Keep the change scoped. A bug fix doesn't need a drive-by refactor; a
   new module doesn't need to also restyle an unrelated screen. Smaller
   PRs get reviewed faster.
3. If your change touches a money, RBAC, or realtime path, re-read the
   relevant rule above and say in the PR description how you satisfied it.
4. Update the relevant doc in the same PR: check off the matching item in
   `ROADMAP.md` if you closed a roadmap item, or note a scope-cut /
   deviation there if you took a different approach than planned — this
   repo's convention is to record deviations inline rather than let docs
   silently drift from the code.

## Commit messages

Write for the *why*, not the *what* — the diff already shows what changed.

```
Fix loyalty point drift on repeated redemptions

Running balance was updated with a DB-side increment on a Float column,
which compounds rounding error over many transactions. Switched to a
rounded read-modify-write set, matching the rule this project inherited
from nodedr-pos's original bug.
```

No fixed prefix convention (`feat:`/`fix:`) is enforced yet — clear prose
is more important than format. Keep the subject line under ~70 characters.

## Opening a pull request

- Target the `master` branch.
- Fill in the PR template (what changed, why, how you tested it).
- Make sure `pnpm lint && pnpm typecheck && pnpm build` pass locally —
  see [Development setup](#development-setup).
- Screenshots or a short clip for anything touching `apps/web` UI —
  this project is held to a real visual bar, and "trust me, it looks
  fine" isn't reviewable.
- Link the issue it closes, if any (`Closes #123`).
- Expect review comments referencing the conventions above by name —
  that's not personal, it's the same bar every change (including the
  maintainer's own) gets held to.

## Reporting bugs

Open an issue with:

- What you expected vs. what happened.
- Repro steps (exact — "click X, then Y" beats "sometimes breaks").
- Whether it's Docker or local dev, and your Node/pnpm/Postgres versions.
- Logs/screenshots if the bug is visual or server-side.

Money-correctness and RBAC bugs (a permission that doesn't actually gate
an action, a total that doesn't match line items) are treated as high
priority — call that out explicitly in the issue title.

## Proposing features / architecture changes

The 20-module scope in `PROJECT.md` is the north star, sequenced by
`ROADMAP.md` — before proposing a new module or a different sequencing,
check both; there's a good chance the tradeoff is already discussed
there. For anything that changes an already-recorded decision (e.g.
database choice, auth model, sync strategy in `ARCHITECTURE.md`), open a
GitHub Discussion or an issue tagged `discussion` laying out:

1. What's recorded today and why (link the doc section).
2. What you're proposing instead, and what changes as a result.
3. What it costs to change now vs. later.

Small, additive proposals (a new report, a new permission, a new
integration) can just be a normal feature-request issue or straight to a
PR.

## Questions & discussion

Use [GitHub Discussions](https://github.com/Raktim94/nodedr-restaurant-pos/discussions)
for "how do I…" / "why does X work this way" / general chat. Use Issues
for concrete bugs and feature requests. Keep architecture debates in
Discussions or a tagged issue rather than scattered across PR comments,
so the reasoning is findable later instead of buried in a merged PR's
history.
