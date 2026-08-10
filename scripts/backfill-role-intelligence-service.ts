// One-time backfill: copies the monolith's role_profiles table into Role Intelligence Service's
// own database (tejoma_role_intelligence). See backfill-identity-service.ts's header comment for
// the full methodology (read-only against the monolith, upsert-by-id, safe to re-run).
//
// Usage:
//   npx tsx scripts/backfill-role-intelligence-service.ts             (writes for real)
//   npx tsx scripts/backfill-role-intelligence-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.ROLE_INTELLIGENCE_SERVICE_DB_NAME || 'tejoma_role_intelligence';

const ROLE_PROFILE_COLUMNS = ['id', 'role_key', 'display_name', 'mandatory_skills', 'preferred_skills', 'optional_skills', 'common_tools', 'typical_responsibilities', 'preferred_certifications', 'experience_band_min', 'experience_band_max', 'related_roles', 'career_progression', 'embedding', 'source', 'created_at', 'updated_at'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Role Intelligence Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await backfillTable(
      source, target,
      { sourceTable: 'role_profiles', targetTable: 'role_profiles', columns: ROLE_PROFILE_COLUMNS },
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
