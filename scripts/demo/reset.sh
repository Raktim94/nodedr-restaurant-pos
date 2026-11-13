#!/usr/bin/env bash
# Puts the public demo back to clean sample data. Runs on the demo server (plain docker, no compose).
# Cron: 0 */3 * * * ~/orderrestro-demo/reset.sh >> ~/orderrestro-demo/reset.log 2>&1
# Steps: stop app -> wipe the demo database -> restore the base dump -> start backend (applies migrations)
#        -> wait until ready -> copy sample adverts -> run seed-demo.mjs -> start web.
set -euo pipefail
cd "$(dirname "$0")"
N=orderrestro-demo
docker stop $N-web $N-backend >/dev/null 2>&1 || true
docker exec -i $N-db psql -U demo -d demo -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i $N-db psql -U demo -d demo -q -v ON_ERROR_STOP=1 < demo-seed.sql
docker start $N-backend >/dev/null
for i in $(seq 1 90); do
  if docker exec $N-backend sh -c 'wget -qO- http://localhost:${PORT:-4000}/api/v1/public/demo-info' >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec $N-backend sh -c 'mkdir -p /data/uploads'
for f in ads/*.png; do docker cp "$f" $N-backend:/data/uploads/"$(basename "$f")"; done
cat seed-demo.mjs | docker exec -i $N-backend sh -c 'cd /app && node --input-type=module -'
docker start $N-web >/dev/null
echo "$(date -Is) demo reset"
