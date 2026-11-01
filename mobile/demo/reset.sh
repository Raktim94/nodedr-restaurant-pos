#!/usr/bin/env bash
# Put the demo back to its clean sample data (plain docker, no compose needed).
# Nightly cron: 17 3 * * * ~/orderrestro-demo/reset.sh >> ~/orderrestro-demo/reset.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
N=orderrestro-demo
docker stop $N-web $N-backend >/dev/null 2>&1 || true
docker exec -i $N-db psql -U demo -d demo -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i $N-db psql -U demo -d demo -q -v ON_ERROR_STOP=1 < demo-seed.sql
docker start $N-backend >/dev/null; sleep 5; docker start $N-web >/dev/null
echo "$(date -Is) demo reset"
