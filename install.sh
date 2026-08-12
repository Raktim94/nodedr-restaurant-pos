#!/usr/bin/env bash
# One-click installer for Nodedr OrderRestro (nodedr-restaurant-pos).
#
# Run this from the repo root after cloning:
#   ./install.sh
#
# Generates a .env with random secrets (only if one doesn't already exist),
# builds the backend + web Docker images, starts the stack, and waits for the
# backend to come up (migrations run automatically on container start). Safe
# to re-run any time (after `git pull`, to rebuild) — nothing here overwrites
# an existing .env or destroys existing data.
#
# Pass --demo to also load seed data (a sample restaurant, menu, and a
# owner@demo.local login) for trying the app out. Without it, sign up your
# own restaurant at /signup — no demo data is created.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

load_demo=false
for arg in "$@"; do
  case "$arg" in
    --demo) load_demo=true ;;
  esac
done

# --- 1. Check prerequisites -------------------------------------------------
# Docker Engine must be installed and the `docker compose` plugin available
# (it ships by default with current Docker Desktop / Docker Engine). See
# "Installing Docker" in README.md for per-OS one-liners if this fails.
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed." >&2
  echo "See 'Installing Docker' in README.md, or https://docs.docker.com/get-docker/ — then re-run this script." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: the 'docker compose' plugin was not found." >&2
  echo "Update Docker Desktop/Engine to a version that bundles Compose v2." >&2
  exit 1
fi

# --- 2. Generate .env if one doesn't exist already --------------------------
# A one-click install can't ask you to hand-edit JWT_SECRET/POSTGRES_PASSWORD
# first (docker-compose.yml has no insecure default for either — it fails
# loudly instead), so generate real random values here. Never overwrites an
# existing .env, so re-running this script is safe.
if [ ! -f .env ]; then
  echo "No .env found — generating one with random secrets..."
  if command -v openssl >/dev/null 2>&1; then
    jwt_secret="$(openssl rand -hex 32)"
    pg_password="$(openssl rand -hex 16)"
  else
    jwt_secret="$(head -c48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c64)"
    pg_password="$(head -c24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c32)"
  fi
  cat > .env <<EOF
POSTGRES_PASSWORD=${pg_password}
JWT_SECRET=${jwt_secret}
FRONTEND_ORIGIN=http://localhost:1995
HOST_PORT=1995
COOKIE_SECURE=false
EOF
  echo ".env created with a generated POSTGRES_PASSWORD and JWT_SECRET."
fi

# --- 3. Build the images and start the stack --------------------------------
echo "Building Nodedr OrderRestro images and starting the stack (this can take a few minutes on first run)..."
docker compose up -d --build

# --- 4. Wait for the app to report healthy ----------------------------------
# The backend container's own start command runs `prisma migrate deploy`
# before it starts listening, so a 200 here means migrations already applied.
HOST_PORT="$(grep -m1 '^HOST_PORT=' .env 2>/dev/null | cut -d= -f2-)"
HOST_PORT="${HOST_PORT:-1995}"

echo "Waiting for the app to come online..."
ready=false
for _ in $(seq 1 90); do
  if curl -sf "http://localhost:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != "true" ]; then
  echo "Warning: the app didn't respond within 90s. Check the logs with:" >&2
  echo "  docker compose logs" >&2
  exit 1
fi

# --- 5. Load demo data (only if --demo was passed) --------------------------
# seed.ts is upsert-based throughout, so this is safe to run on every install/
# re-install without duplicating or clobbering anything.
if [ "$load_demo" = true ]; then
  echo "Loading demo data (restaurant, menu, staff logins)..."
  docker exec nodedr-restaurant-backend npx ts-node prisma/seed.ts
fi

# --- 6. Done -----------------------------------------------------------------
echo ""
echo "Nodedr OrderRestro is up and running."
echo "Open http://localhost:${HOST_PORT}"
if [ "$load_demo" = true ]; then
  echo "Sign in with the demo account: owner@demo.local / Password123!"
  echo "(demo account — change the password or remove it before real use)"
else
  echo "Create your restaurant account at http://localhost:${HOST_PORT}/signup"
fi
