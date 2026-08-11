#!/bin/bash
# Tejoma PostgreSQL Backup Script
# Backs up all 20 tejoma databases to compressed SQL files

set -euo pipefail

# Source .env.local to ensure DB credentials are available
if [ -f ".env.local" ]; then
  set +u # Allow unset variables for env sourcing
  source .env.local || true
  set -u
fi

BACKUP_DIR="${1:-./.backups}"
RETENTION_DAYS="${2:-30}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"

echo "Using DB_HOST=${DB_HOST}, DB_USER=${DB_USER}, DB_PORT=${DB_PORT}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_RUN_DIR="${BACKUP_DIR}/${TIMESTAMP}"
LOG_FILE="${BACKUP_RUN_DIR}/backup.log"

DATABASES=(
  "tejoma_recruiting" "tejoma_identity" "tejoma_platform_governance"
  "tejoma_tenant_directory" "tejoma_candidate" "tejoma_chat"
  "tejoma_recruiting_service" "tejoma_analytics" "tejoma_matching_evaluation"
  "tejoma_matching_reasoning" "tejoma_matching_skill_discovery"
  "tejoma_matching_bge_shadow" "tejoma_role_intelligence"
  "tejoma_career_intelligence" "tejoma_dynamic_weighting"
  "tejoma_job" "tejoma_candidate_core" "tejoma_matching_decision"
  "tejoma_matching_scoring"
)

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

mkdir -p "${BACKUP_RUN_DIR}"

{
  echo "=========================================="
  echo "Tejoma PostgreSQL Backup"
  echo "=========================================="
  echo "Run: ${TIMESTAMP}"
  echo "Host: ${DB_HOST}:${DB_PORT}"
  echo "User: ${DB_USER}"
  echo "Databases: ${#DATABASES[@]}"
  echo ""
} | tee "${LOG_FILE}"

BACKUP_COUNT=0
BACKUP_FAILED=0

for db in "${DATABASES[@]}"; do
  backup_file="${BACKUP_RUN_DIR}/${db}.sql.gz"
  temp_file="${BACKUP_RUN_DIR}/.${db}.sql.tmp"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backing up: ${db}..." | tee -a "${LOG_FILE}"

  # Export password for docker
  export PGPASSWORD="${DB_PASSWORD}"

  # Run pg_dump
  docker run --rm \
    -e PGPASSWORD="${DB_PASSWORD}" \
    postgres:18-alpine \
    pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${db}" \
    > "${temp_file}" 2>&1

  dump_result=$?

  if [ ${dump_result} -eq 0 ] && [ -s "${temp_file}" ]; then
    gzip -9 "${temp_file}"
    mv "${temp_file}.gz" "${backup_file}"
    size=$(du -h "${backup_file}" | cut -f1)
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] ✓ ${db} (${size})${NC}" | tee -a "${LOG_FILE}"
    ((BACKUP_COUNT++))
  else
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ✗ ${db} - Failed${NC}" | tee -a "${LOG_FILE}"
    if [ -f "${temp_file}" ]; then
      echo "Error output:" | tee -a "${LOG_FILE}"
      head -10 "${temp_file}" | tee -a "${LOG_FILE}"
    fi
    ((BACKUP_FAILED++))
    rm -f "${temp_file}" 2>/dev/null || true
  fi
done

{
  echo ""
  echo "=========================================="
  echo "Backup Summary"
  echo "=========================================="
  echo "Successful: ${BACKUP_COUNT} / ${#DATABASES[@]}"
  echo "Failed: ${BACKUP_FAILED}"
  echo ""
} | tee -a "${LOG_FILE}"

# Validate
VALID=0
for f in "${BACKUP_RUN_DIR}"/*.sql.gz; do
  if [ -f "$f" ] && gzip -t "$f" 2>/dev/null; then
    ((VALID++))
  fi
done
echo "Valid backups: ${VALID}" | tee -a "${LOG_FILE}"

# Retention
find "${BACKUP_DIR}" -maxdepth 1 -type d -name '[0-9]*_[0-9]*' -mtime +${RETENTION_DAYS} -exec rm -rf {} \; 2>/dev/null || true

# Manifest
{
  echo "Tejoma Backup Manifest"
  echo "Date: $(date)"
  echo "Location: ${BACKUP_RUN_DIR}"
  echo "Backups: ${BACKUP_COUNT} / ${#DATABASES[@]}"
  echo ""
  echo "To restore:"
  echo "  Single: ./scripts/restore-database.sh ${BACKUP_RUN_DIR} <db>"
  echo "  Test:   ./scripts/restore-database.sh ${BACKUP_RUN_DIR} <db> test"
  echo "  All:    ./scripts/restore-database.sh ${BACKUP_RUN_DIR}"
} > "${BACKUP_RUN_DIR}/MANIFEST.txt"

echo "" | tee -a "${LOG_FILE}"
echo "=========================================="  | tee -a "${LOG_FILE}"

if [ ${BACKUP_FAILED} -eq 0 ] && [ ${BACKUP_COUNT} -gt 0 ]; then
  echo -e "${GREEN}✓ Backup successful!${NC}" | tee -a "${LOG_FILE}"
  echo "Location: ${BACKUP_RUN_DIR}" | tee -a "${LOG_FILE}"
  exit 0
else
  echo -e "${RED}✗ Backup failed (${BACKUP_FAILED} errors)${NC}" | tee -a "${LOG_FILE}"
  exit 1
fi
