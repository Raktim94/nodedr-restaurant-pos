# Built from the MONOREPO ROOT context (see docker-compose.yml `context: .`)
# because this app depends on the workspace package @nodedr-restaurant/types.
# Do not try to `docker build` this file with apps/backend as context.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- deps: install with full workspace visible so pnpm can link @nodedr-restaurant/types ---
FROM base AS deps
RUN apk add --no-cache openssl
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

# --- builder: compile types package, generate Prisma client, build Nest ---
FROM deps AS builder
COPY packages/types packages/types
COPY apps/backend apps/backend
RUN pnpm --filter @nodedr-restaurant/types build
RUN pnpm --filter @nodedr-restaurant/backend exec prisma generate
RUN pnpm --filter @nodedr-restaurant/backend build

# --- runtime: slim image, only what's needed to run ---
# Keeps the SAME directory depth as the workspace (/repo/apps/backend, not a
# flattened /app) — pnpm's per-package node_modules/.bin/* entries (prisma,
# nest, etc.) are symlinks with relative paths back into the root
# node_modules/.pnpm store, and flattening the tree breaks them silently
# (npx then can't find the local `prisma` binary and falls back to fetching
# an arbitrary "latest" version from the registry at container start).
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /repo/apps/backend/dist ./apps/backend/dist
COPY --from=builder /repo/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /repo/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /repo/packages/types/dist ./packages/types/dist
COPY --from=builder /repo/packages/types/package.json ./packages/types/package.json
COPY --from=builder /repo/packages/types/node_modules ./packages/types/node_modules

WORKDIR /repo/apps/backend
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
