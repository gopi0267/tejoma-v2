// One-time backfill: copies the monolith's recruiter_notifications table into Recruiting
// Service's own database (tejoma_recruiting_service). See backfill-identity-service.ts's header
// comment for the full methodology (read-only against the monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-recruiting-service.ts             (writes for real)
//   npx tsx scripts/backfill-recruiting-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.RECRUITING_SERVICE_DB_NAME || 'tejoma_recruiting_service';

const RECRUITER_NOTIFICATION_COLUMNS = ['id', 'user_id', 'company_id', 'match_id', 'type', 'title', 'message', 'read_at', 'created_at'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Recruiting Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source, target,
      { sourceTable: 'recruiter_notifications', targetTable: 'recruiter_notifications', columns: RECRUITER_NOTIFICATION_COLUMNS },
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
