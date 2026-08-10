// Validates that Identity Service's database is a faithful, complete mirror of the monolith's
// corresponding tables - the "validate" step of Phase 11 section 12's migration methodology, run
// after backfill-identity-service.ts (and, in a later batch, after dual-write has been running).
// Exits non-zero if any mismatch is found - this is meant to gate a real cutover decision, not
// just report information for a human to eyeball.
//
// otp_verification is intentionally excluded - see backfill-identity-service.ts's header comment
// (transient, never backfilled, so there is nothing meaningful to compare).
//
// Usage: npx tsx scripts/validate-identity-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.IDENTITY_DB_NAME || 'tejoma_identity';

async function main() {
  console.log(`=== Validating Identity Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const results = await Promise.all([
      compareTable(source, target, {
        sourceTable: 'users',
        targetTable: 'users',
        columns: [
          'id', 'email', 'password_hash', 'company_id', 'role', 'is_active', 'name',
          'created_at', 'updated_at', 'phone', 'deleted_at', 'created_by', 'updated_by',
          'disabled_by', 'password_reset_by', 'last_login_at',
        ],
      }),
      compareTable(source, target, {
        sourceTable: 'refresh_tokens',
        targetTable: 'refresh_tokens',
        columns: ['id', 'user_id', 'token_hash', 'user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'remember'],
      }),
      compareTable(source, target, {
        sourceTable: 'password_history',
        targetTable: 'password_history',
        columns: ['id', 'user_id', 'password_hash', 'created_at'],
      }),
      compareTable(source, target, {
        sourceTable: 'candidate_accounts',
        targetTable: 'candidate_accounts',
        columns: ['id', 'name', 'email', 'phone', 'password_hash', 'is_active', 'deleted_at', 'created_at', 'updated_at'],
      }),
      compareTable(source, target, {
        sourceTable: 'candidate_refresh_tokens',
        targetTable: 'candidate_refresh_tokens',
        columns: ['id', 'candidate_id', 'token_hash', 'user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'remember'],
      }),
    ]);

    for (const r of results) printCompareResult(r);

    const allOk = results.every((r) => r.ok);
    console.log(allOk ? '\n✓ Identity Service is fully in sync with the monolith.' : '\n✗ Identity Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
    process.exitCode = allOk ? 0 : 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
