#!/usr/bin/env bash
# Starts the public demo with plain `docker run`. Idempotent: containers are replaced, data is kept.
# Needs ./.env with DEMO_DB_PASSWORD, DEMO_JWT_SECRET, DEMO_ORIGIN, DEMO_COOKIE_SECURE, APP_VERSION.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
IMG=ghcr.io/raktim94/nodedr-restaurant-pos
N=orderrestro-demo
docker network inspect $N >/dev/null 2>&1 || docker network create $N >/dev/null
docker volume inspect $N-pg >/dev/null 2>&1 || docker volume create $N-pg >/dev/null
docker rm -f $N-web $N-backend >/dev/null 2>&1 || true
docker inspect $N-db >/dev/null 2>&1 || docker run -d --name $N-db --restart unless-stopped --network $N --memory 256m \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD="${DEMO_DB_PASSWORD}" -e POSTGRES_DB=demo -v $N-pg:/var/lib/postgresql/data \
  postgres:16-alpine >/dev/null
docker start $N-db >/dev/null
until docker exec $N-db pg_isready -U demo >/dev/null 2>&1; do sleep 1; done
docker run -d --name $N-backend --restart unless-stopped --network $N --network-alias backend --memory 512m \
  -e DATABASE_URL="postgresql://demo:${DEMO_DB_PASSWORD}@$N-db:5432/demo" -e JWT_SECRET="${DEMO_JWT_SECRET}" \
  -e JWT_EXPIRES_IN=12h -e PORT=4000 -e CORS_ORIGIN="$DEMO_ORIGIN" -e COOKIE_SECURE="${DEMO_COOKIE_SECURE:-true}" \
  -e TRUST_PROXY=1 -e UPLOADS_DIR=/data/uploads \
  -e DEMO_MODE=true -e DEMO_USER_EMAIL=demo@orderrestro.nodedr.com -e DEMO_RESET_HOURS=3 \
  $IMG-backend:"$APP_VERSION" >/dev/null
docker run -d --name $N-web --restart unless-stopped --network $N --memory 384m -p 127.0.0.1:19951:3000 \
  $IMG-web:"$APP_VERSION" >/dev/null
echo "demo up (version $APP_VERSION)"
