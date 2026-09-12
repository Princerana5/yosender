#!/bin/bash
# 8xtelSMPP production deploy / update. Idempotent — safe to re-run.
# Usage: ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Missing .env — copy .env.prod.example → .env and fill secrets first."; exit 1; }
grep -q "REQUIRED" .env && { echo "ERROR: .env still contains REQUIRED placeholders. Fill them first."; exit 1; }

echo "── build ──"
docker compose build

echo "── start infra ──"
docker compose up -d postgres redis
echo "waiting for healthy postgres/redis…"
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-xtel}" > /dev/null 2>&1 \
  && docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 2
done

echo "── migrate ──"
docker compose run --rm api node dist/db/migrate.js 2>/dev/null \
  || docker compose exec api node dist/db/migrate.js

echo "── start all ──"
docker compose up -d
sleep 8
docker compose ps
echo ""
echo "API health: $(curl -sk -o /dev/null -w '%{http_code}' https://localhost/api/health || curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health)"
echo "Done. Panel: https://$(grep PANEL_HOST .env | cut -d= -f2)/"
