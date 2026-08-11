#!/bin/bash
# Tejoma PostgreSQL Restore Script (Docker-based)
# Restores one or all databases from a backup directory
# Usage: ./scripts/restore-database.sh <backup_dir> [database_name] [test_only]

set -euo pipefail

BACKUP_DIR="${1:-.}"
DATABASE_TO_RESTORE="${2:-}"
TEST_MODE="${3:-}"

DB_HOST="${DB_HOST:-host.docker.internal}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${BACKUP_DIR}/restore.log"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $@" | tee -a "${LOG_FILE}"
}

log_error() {
  echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $@${NC}" | tee -a "${LOG_FILE}" >&2
}

log_success() {
  echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $@${NC}" | tee -a "${LOG_FILE}"
}

log_warn() {
  echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARN: $@${NC}" | tee -a "${LOG_FILE}"
}

{
  echo "=========================================="
  echo "Tejoma PostgreSQL Restore"
  echo "=========================================="
  echo "Backup directory: ${BACKUP_DIR}"
  echo "Restore timestamp: ${TIMESTAMP}"
  if [ -n "${DATABASE_TO_RESTORE}" ]; then
    echo "Database: ${DATABASE_TO_RESTORE}"
  else
    echo "Restoring ALL databases (DESTRUCTIVE!)"
  fi
  if [ "${TEST_MODE}" = "test" ]; then
    echo "Mode: TEST (temporary database)"
  fi
  echo ""
} | tee "${LOG_FILE}"

if [ ! -d "${BACKUP_DIR}" ]; then
  log_error "Backup directory not found: ${BACKUP_DIR}"
  exit 1
fi

BACKUP_FILES=()
while IFS= read -r file; do
  BACKUP_FILES+=("$file")
done < <(find "${BACKUP_DIR}" -maxdepth 1 -name "*.sql.gz" 2>/dev/null | sort)

if [ ${#BACKUP_FILES[@]} -eq 0 ]; then
  log_error "No backup files found in ${BACKUP_DIR}"
  exit 1
fi

log_info "Found ${#BACKUP_FILES[@]} backup files"

restore_database() {
  local backup_file=$1
  local target_db=$2
  local is_test=${3:-false}

  local db_name=$(basename "${backup_file}" .sql.gz)

  if [ "${is_test}" = "true" ]; then
    target_db="${db_name}_test_${TIMESTAMP}"
    log_info "TEST MODE: Restoring to: ${target_db}"
  fi

  # Drop database
  if [ "${is_test}" != "true" ]; then
    log_info "Dropping database: ${target_db}..."
    docker run --rm \
      -e PGPASSWORD="${DB_PASSWORD}" \
      postgres:18-alpine \
      psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
      -c "DROP DATABASE IF EXISTS ${target_db};" 2>/dev/null || true
  fi

  # Create database
  log_info "Creating database: ${target_db}..."
  docker run --rm \
    -e PGPASSWORD="${DB_PASSWORD}" \
    postgres:18-alpine \
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
    -c "CREATE DATABASE ${target_db};" 2>/dev/null

  # Restore
  log_info "Restoring from backup..."
  gunzip -c "${backup_file}" | docker run --rm -i \
    -e PGPASSWORD="${DB_PASSWORD}" \
    postgres:18-alpine \
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${target_db}" \
    --set ON_ERROR_STOP=on 2>/dev/null || return 1

  # Verify
  log_info "Verifying..."
  table_count=$(docker run --rm \
    -e PGPASSWORD="${DB_PASSWORD}" \
    postgres:18-alpine \
    psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${target_db}" -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null)

  log_success "Restore complete. Tables: ${table_count}"
  return 0
}

# Single database restore
if [ -n "${DATABASE_TO_RESTORE}" ]; then
  backup_file="${BACKUP_DIR}/${DATABASE_TO_RESTORE}.sql.gz"

  if [ ! -f "${backup_file}" ]; then
    log_error "Backup file not found: ${backup_file}"
    exit 1
  fi

  if [ "${TEST_MODE}" = "test" ]; then
    log_info "Running test restore..."
    if restore_database "${backup_file}" "${DATABASE_TO_RESTORE}" "true"; then
      test_db="${DATABASE_TO_RESTORE}_test_${TIMESTAMP}"
      log_success "Test restore successful: ${test_db}"
      log_info ""
      log_info "To cleanup:"
      log_info "  docker run --rm -e PGPASSWORD=${DB_PASSWORD} postgres:18-alpine psql -h ${DB_HOST} -U ${DB_USER} -d postgres -c \"DROP DATABASE ${test_db};\""
      exit 0
    else
      log_error "Test restore FAILED"
      exit 1
    fi
  else
    log_warn "DESTRUCTIVE: Will overwrite ${DATABASE_TO_RESTORE}"
    read -p "Continue? (yes/no): " -r confirm
    [ "${confirm}" = "yes" ] || { log_error "Cancelled"; exit 1; }

    if restore_database "${backup_file}" "${DATABASE_TO_RESTORE}" "false"; then
      log_success "Database restored"
      exit 0
    else
      log_error "Restore FAILED"
      exit 1
    fi
  fi
else
  # All databases
  log_error "===== DESTRUCTIVE ====="
  log_error "About to restore ALL databases from:"
  log_error "${BACKUP_DIR}"
  for backup_file in "${BACKUP_FILES[@]}"; do
    log_error "  - $(basename ${backup_file} .sql.gz)"
  done
  log_error "======================="
  read -p "I understand. Type 'restore all': " -r confirm
  [ "${confirm}" = "restore all" ] || { log_error "Cancelled"; exit 1; }

  RESTORE_SUCCESS=0
  RESTORE_FAILED=0

  for backup_file in "${BACKUP_FILES[@]}"; do
    db_name=$(basename "${backup_file}" .sql.gz)
    log_info ""
    log_info "Restoring ${db_name}..."

    if restore_database "${backup_file}" "${db_name}" "false"; then
      ((RESTORE_SUCCESS++))
    else
      ((RESTORE_FAILED++))
    fi
  done

  log_info ""
  log_info "=========================================="
  log_info "Restore Summary"
  log_info "=========================================="
  log_info "Successful: ${RESTORE_SUCCESS} / ${#BACKUP_FILES[@]}"
  log_info "Failed: ${RESTORE_FAILED}"

  if [ ${RESTORE_FAILED} -eq 0 ]; then
    log_success "All databases restored!"
    exit 0
  else
    log_error "Some restores FAILED"
    exit 1
  fi
fi
