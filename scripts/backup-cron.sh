#!/bin/sh
# Scheduled backup loop for the Tejoma stack.
#
# Runs inside the `db-backup` compose service (see docker-compose.yml). Deliberately a plain sleep
# loop rather than a cron daemon: the container has one job, cron adds a second process to
# supervise and swallows stdout/stderr into its own mail spool, whereas this keeps every backup
# result on the container's stdout where `docker compose logs db-backup` and any log shipper can
# see it. Failures are loud - a non-zero exit from the backup script is logged as FAILED and the
# loop continues so one bad run never stops all future backups.
#
# BACKUP_INTERVAL_SECONDS defaults to 24h. BACKUP_RETENTION_DAYS is passed straight through to
# scripts/backup-database.sh, which already implements retention cleanup.
set -u

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
OUT="${BACKUP_DIR:-/backups}"

echo "[backup-cron] started - interval=${INTERVAL}s retention=${RETENTION}d out=${OUT}"

# backup-database.sh is bash (it uses arrays). This image is Alpine, whose /bin/sh is busybox ash
# and fails on `DATABASES=(...)` with "syntax error: unexpected (". Install bash once at startup
# rather than rewriting a working, hand-verified backup script into POSIX sh.
if ! command -v bash >/dev/null 2>&1; then
  echo "[backup-cron] installing bash (required by backup-database.sh)"
  apk add --no-cache bash >/dev/null 2>&1 || {
    echo "[backup-cron] FAILED - could not install bash; backups cannot run"
    exit 1
  }
fi

# Delay the first run so the databases are up if the whole stack started together.
sleep "${BACKUP_STARTUP_DELAY_SECONDS:-60}"

while true; do
  START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "[backup-cron] ${START} starting backup run"

  if bash /app/scripts/backup-database.sh "${OUT}" "${RETENTION}"; then
    echo "[backup-cron] $(date -u +%Y-%m-%dT%H:%M:%SZ) SUCCESS"
  else
    # Loud, greppable, and non-fatal. Alert on this string.
    echo "[backup-cron] $(date -u +%Y-%m-%dT%H:%M:%SZ) FAILED - backup run returned non-zero"
  fi

  sleep "${INTERVAL}"
done
