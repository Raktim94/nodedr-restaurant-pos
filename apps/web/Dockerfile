# Built from the MONOREPO ROOT context (see docker-compose.yml `context: .`)
# because this app depends on the workspace package @nodedr-restaurant/types.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- deps ---
# The workspace lockfile includes apps/backend's `usb` dependency (direct-USB
# ESC/POS printing, see apps/backend/src/modules/orders/escpos-usb.ts) even
# though this app never imports it — `pnpm install --frozen-lockfile` still
# builds every workspace member's native addons. Same toolchain apps/backend/
# Dockerfile needs, for the same reason (see that file's comment).
FROM base AS deps
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev libusb-dev pkgconfig
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

# --- builder ---
# BACKEND_URL is a build ARG, not a runtime env — Next.js bakes rewrite
# destinations into the routes manifest at build time (see next.config.ts
# and ARCHITECTURE.md's "reused from nodedr-pos" section for why a runtime
# env silently falls back to the default instead).
FROM deps AS builder
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=${BACKEND_URL}
COPY packages/types packages/types
COPY apps/web apps/web
RUN pnpm --filter @nodedr-restaurant/types build
RUN pnpm --filter web build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The standalone server (apps/web/server.js) resolves `public/` and
# `.next/static` relative to ITS OWN traced monorepo path, i.e.
# apps/web/public and apps/web/.next/static under this WORKDIR — not a
# top-level ./public. Copying public/ to ./public (a sibling of apps/, not
# a child) silently 404s every static asset (logo, icons, favicon fallback)
# in production while `next dev` keeps working fine, since dev serves
# public/ directly from the source tree regardless of this path.
COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
