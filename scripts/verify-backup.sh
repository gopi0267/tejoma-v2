#!/usr/bin/env bash
#
# Fast integrity check for a backup produced by scripts/backup-db.sh - confirms the gzip
# stream isn't corrupt/truncated and that it actually contains table data, without doing a full
# test restore (which is slower and needs a throwaway database - see scripts/restore-db.sh for
# that, the authoritative verification method for critical backups).
#
# Usage: ./scripts/verify-backup.sh backups/tejoma_recruiting_20260101_020000.sql.gz
set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <path-to-backup.sql.gz>" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "Checking gzip integrity of $BACKUP_FILE ..."
if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "FAIL: gzip stream is corrupt or truncated." >&2
  exit 1
fi
echo "  OK - gzip stream is valid."

TABLE_COUNT=$(gunzip -c "$BACKUP_FILE" | grep -c '^COPY ' || true)
if [ "$TABLE_COUNT" -eq 0 ]; then
  echo "FAIL: backup contains no table data (0 COPY statements) - likely an empty/broken dump." >&2
  exit 1
fi
echo "  OK - found data for $TABLE_COUNT table(s)."

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "PASS: $BACKUP_FILE looks valid ($SIZE, $TABLE_COUNT tables)."
