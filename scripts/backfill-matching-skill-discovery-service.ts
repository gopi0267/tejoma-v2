// One-time backfill: copies the monolith's skill_nodes table into Matching Skill Discovery
// Service's own database (tejoma_matching_skill_discovery). See backfill-identity-service.ts's
// header comment for the full methodology (read-only against the monolith, upsert-by-id, safe to
// re-run). skill_discovery_proposals is NOT backfilled - it is computed and stored independently
// by this service's own logic when the monolith's shadow caller invokes it, not a 1:1 mirror of
// the monolith's own table (same reasoning as reasoning_conclusions, MIGRATION_RUNBOOK.md §6k).
// skill_edges is also NOT backfilled here - this service never reads it (see its own README.md).
//
// Usage:
//   npx tsx scripts/backfill-matching-skill-discovery-service.ts             (writes for real)
//   npx tsx scripts/backfill-matching-skill-discovery-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.MATCHING_SKILL_DISCOVERY_SERVICE_DB_NAME || 'tejoma_matching_skill_discovery';

const SKILL_NODE_COLUMNS = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Matching Skill Discovery Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const nodeResult = await backfillTable(
      source, target,
      { sourceTable: 'skill_nodes', targetTable: 'skill_nodes', columns: SKILL_NODE_COLUMNS },
      dryRun
    );

    console.log('\n=== Summary ===');
    console.log(`  ${nodeResult.table.padEnd(24)} read=${nodeResult.read}  ${dryRun ? '' : `written=${nodeResult.written}`}`);
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
