#!/bin/bash
# Daily Postgres backup → scripts/backups/. Keeps 14 days. Run via cron:
#   0 3 * * * /opt/8xtelsmpp/scripts/backup.sh >> /var/log/xtel-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="scripts/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F_%H%M)"
FILE="$BACKUP_DIR/xtelsmpp-$STAMP.sql.gz"

echo "[$(date -Is)] backup → $FILE"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-xtel}" "${POSTGRES_DB:-xtelsmpp}" \
  | gzip > "$FILE"

# Redis RDB snapshot (AOF already persists; this is a second copy)
docker compose exec -T redis redis-cli BGSAVE > /dev/null
sleep 2
docker cp "$(docker compose ps -q redis):/data/dump.rdb" "$BACKUP_DIR/redis-$STAMP.rdb" 2>/dev/null || true

# Prune: keep 14 newest of each
ls -t "$BACKUP_DIR"/xtelsmpp-*.sql.gz | tail -n +15 | xargs -r rm --
ls -t "$BACKUP_DIR"/redis-*.rdb 2>/dev/null | tail -n +15 | xargs -r rm --

echo "[$(date -Is)] done: $(du -h "$FILE" | cut -f1)"
echo "Restore: gunzip -c $FILE | docker compose exec -T postgres psql -U ${POSTGRES_USER:-xtel} ${POSTGRES_DB:-xtelsmpp}"
