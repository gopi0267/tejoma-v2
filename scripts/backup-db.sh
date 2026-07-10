#!/usr/bin/env bash
#
# Free, self-managed Postgres backup for Tejoma Recruiting.
# Uses pg_dump (bundled with any PostgreSQL install) - no paid service required.
#
# Usage:
#   ./scripts/backup-db.sh
#
# Reads DB connection details from .env.local (same variables db.ts uses), so this stays
# in sync automatically - no separate credentials to maintain.
#
# Scheduling (pick one, both free):
#   cron (Linux prod server):
#     0 2 * * * cd /path/to/tejoma-rec && ./scripts/backup-db.sh >> /var/log/tejoma-backup.log 2>&1
#   Windows Task Scheduler (local/dev):
#     Action: Start a program -> "C:\Program Files\Git\bin\bash.exe" -> Arguments: scripts/backup-db.sh
#     Trigger: Daily
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"
BACKUP_DIR="$PROJECT_ROOT/backups"
RETENTION_DAYS=14

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Load DB_* variables from .env.local without executing arbitrary shell content.
DB_HOST=$(grep -E '^DB_HOST=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_PORT=$(grep -E '^DB_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_NAME=$(grep -E '^DB_NAME=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_USER=$(grep -E '^DB_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-tejoma_recruiting}"
DB_USER="${DB_USER:-postgres}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "Backing up $DB_NAME @ $DB_HOST:$DB_PORT -> $OUT_FILE"

PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-owner \
  --no-privileges \
  | gzip > "$OUT_FILE"

echo "Backup complete: $(du -h "$OUT_FILE" | cut -f1)"

# Prune backups older than RETENTION_DAYS - keeps disk usage bounded without a second tool.
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete

echo "Retention: pruned backups older than ${RETENTION_DAYS} days"
