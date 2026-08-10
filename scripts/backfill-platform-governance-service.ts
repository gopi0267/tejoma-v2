// One-time backfill: copies the monolith's company_registration_requests table into Platform
// Governance Service's own database (tejoma_platform_governance). See
// backfill-identity-service.ts's header comment for the full methodology.
//
// reviewed_by/resulting_company_id/resulting_user_id are copied as plain integer values, exactly
// as the monolith has them - they are opaque references to Identity DB's users.id / Tenant
// Directory's companies.id in the target schema (see platform-governance-service/migrations/
// 001_initial_schema.up.sql's header comment), and remain numerically correct as long as
// backfill-identity-service.ts and backfill-tenant-directory-service.ts preserve the same ids,
// which they do.
//
// Usage:
//   npx tsx scripts/backfill-platform-governance-service.ts             (writes for real)
//   npx tsx scripts/backfill-platform-governance-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.PLATFORM_GOVERNANCE_DB_NAME || 'tejoma_platform_governance';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Platform Governance Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source,
      target,
      {
        sourceTable: 'company_registration_requests',
        targetTable: 'company_registration_requests',
        columns: [
          'id', 'company_name', 'company_website', 'industry', 'company_size', 'business_email',
          'company_phone', 'country', 'state', 'city', 'address', 'admin_name', 'admin_email',
          'admin_phone', 'password_hash', 'status', 'review_notes', 'reviewed_by', 'reviewed_at',
          'resulting_company_id', 'resulting_user_id', 'created_at', 'updated_at',
        ],
      },
      dryRun
    );

    console.log('\n=== Summary ===');
    console.log(`  ${result.table.padEnd(30)} read=${result.read}  ${dryRun ? '' : `written=${result.written}`}`);
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
