// One-time backfill: copies the monolith's companies table into Tenant Directory Service's own
// database (tejoma_tenant_directory). See backfill-identity-service.ts's header comment for the
// full methodology (read-only against the monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-tenant-directory-service.ts             (writes for real)
//   npx tsx scripts/backfill-tenant-directory-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.TENANT_DIRECTORY_DB_NAME || 'tejoma_tenant_directory';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Tenant Directory Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source,
      target,
      {
        sourceTable: 'companies',
        targetTable: 'companies',
        columns: ['id', 'name', 'industry', 'plan', 'seats_limit', 'is_active', 'created_at', 'updated_at', 'company_slug', 'logo_url', 'website'],
      },
      dryRun
    );

    console.log('\n=== Summary ===');
    console.log(`  ${result.table.padEnd(24)} read=${result.read}  ${dryRun ? '' : `written=${result.written}`}`);
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
