#!/usr/bin/env bash
#
# Restores a Tejoma Postgres backup produced by scripts/backup-db.sh.
#
# Usage:
#   ./scripts/restore-db.sh backups/tejoma_recruiting_20260101_020000.sql.gz
#   ./scripts/restore-db.sh backups/tejoma_recruiting_20260101_020000.sql.gz --yes   # skip confirmation
#
# Reads DB connection details from .env.local, same as backup-db.sh. Restoring OVERWRITES the
# target database's contents - by default this asks for interactive confirmation naming the
# exact database it's about to overwrite; pass --yes to skip that (e.g. in a scripted DR drill
# against a throwaway database).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

BACKUP_FILE="${1:-}"
SKIP_CONFIRM="${2:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-backup.sql.gz> [--yes]" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

DB_HOST=$(grep -E '^DB_HOST=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_PORT=$(grep -E '^DB_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_NAME=$(grep -E '^DB_NAME=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_USER=$(grep -E '^DB_USER=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"')

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-tejoma_recruiting}"
DB_USER="${DB_USER:-postgres}"

PSQL_BIN="psql"
if ! command -v psql >/dev/null 2>&1; then
  for candidate in /c/Program\ Files/PostgreSQL/*/bin/psql.exe; do
    if [ -f "$candidate" ]; then
      PSQL_BIN="$candidate"
      break
    fi
  done
  if [ "$PSQL_BIN" = "psql" ]; then
    echo "ERROR: psql not found on PATH or in a standard Windows PostgreSQL install location." >&2
    exit 1
  fi
fi

if [ "$SKIP_CONFIRM" != "--yes" ]; then
  echo "This will OVERWRITE all data in database '$DB_NAME' @ $DB_HOST:$DB_PORT"
  echo "with the contents of: $BACKUP_FILE"
  read -r -p "Type the database name to confirm ('$DB_NAME'): " CONFIRM
  if [ "$CONFIRM" != "$DB_NAME" ]; then
    echo "Confirmation did not match - aborted, nothing was restored."
    exit 1
  fi
fi

echo "Restoring $BACKUP_FILE -> $DB_NAME @ $DB_HOST:$DB_PORT ..."

gunzip -c "$BACKUP_FILE" | PGPASSWORD="$DB_PASSWORD" "$PSQL_BIN" \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --quiet

echo "Restore complete."
