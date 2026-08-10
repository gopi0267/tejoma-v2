// One-time backfill: copies existing monolith data into Identity Service's own database
// (tejoma_identity), as the first step of Phase 11 section 12's migration methodology
// (backfill -> dual-write -> shadow-read -> validate -> cutover -> rollback -> legacy removal).
// This script is entirely read-only against the monolith - it only ever writes to the target.
//
// Five tables, in parent-before-child order (no FK enforcement in the target database - see
// identity-service/migrations/001_initial_schema.up.sql's header comment on why - but the
// ordering still keeps a partial/interrupted run easy to reason about):
//   users -> refresh_tokens -> password_history -> candidate_accounts -> candidate_refresh_tokens
//
// candidate_accounts is the one table where source and target column lists genuinely differ:
// the monolith's row also carries profile columns (headline, skills, education, etc.) that
// Identity DB deliberately does not own (Phase 3(database) section 4's auth/profile split,
// executed in Batch 3) - only the auth columns are selected and copied.
//
// otp_verification is intentionally NOT backfilled: it is transient (10-minute TTL), and at
// actual cutover time any real monolith OTP row will already be expired - there is nothing
// meaningful to carry over.
//
// Safe to re-run: every table is upserted by id (ON CONFLICT DO UPDATE), so re-running after
// further monolith writes converges the target to the monolith's current state.
//
// Usage:
//   npx tsx scripts/backfill-identity-service.ts             (writes for real)
//   npx tsx scripts/backfill-identity-service.ts --dry-run    (reports counts only, no writes)

import { connectMonolith, connectTarget, backfillTable, type BackfillResult } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.IDENTITY_DB_NAME || 'tejoma_identity';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Identity Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);
  const results: BackfillResult[] = [];

  try {
    results.push(
      await backfillTable(
        source,
        target,
        {
          sourceTable: 'users',
          targetTable: 'users',
          columns: [
            'id', 'email', 'password_hash', 'company_id', 'role', 'is_active', 'name',
            'created_at', 'updated_at', 'phone', 'deleted_at', 'created_by', 'updated_by',
            'disabled_by', 'password_reset_by', 'last_login_at',
          ],
        },
        dryRun
      )
    );

    results.push(
      await backfillTable(
        source,
        target,
        {
          sourceTable: 'refresh_tokens',
          targetTable: 'refresh_tokens',
          columns: ['id', 'user_id', 'token_hash', 'user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'remember'],
        },
        dryRun
      )
    );

    results.push(
      await backfillTable(
        source,
        target,
        {
          sourceTable: 'password_history',
          targetTable: 'password_history',
          columns: ['id', 'user_id', 'password_hash', 'created_at'],
        },
        dryRun
      )
    );

    results.push(
      await backfillTable(
        source,
        target,
        {
          sourceTable: 'candidate_accounts',
          targetTable: 'candidate_accounts',
          // Auth columns only - see this file's header comment.
          columns: ['id', 'name', 'email', 'phone', 'password_hash', 'is_active', 'deleted_at', 'created_at', 'updated_at'],
        },
        dryRun
      )
    );

    results.push(
      await backfillTable(
        source,
        target,
        {
          sourceTable: 'candidate_refresh_tokens',
          targetTable: 'candidate_refresh_tokens',
          columns: ['id', 'candidate_id', 'token_hash', 'user_agent', 'ip_address', 'created_at', 'expires_at', 'revoked_at', 'remember'],
        },
        dryRun
      )
    );

    console.log('\n=== Summary ===');
    for (const r of results) {
      console.log(`  ${r.table.padEnd(24)} read=${r.read}  ${dryRun ? '' : `written=${r.written}`}`);
    }
    console.log(dryRun ? '\nDry run complete - no data was written.' : '\nBackfill complete.');
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
