// One-time backfill: copies the monolith's skill_nodes and skill_edges tables into Matching
// Reasoning Service's own database (tejoma_matching_reasoning). See
// backfill-identity-service.ts's header comment for the full methodology (read-only against the
// monolith, upsert-by-id, safe to re-run). reasoning_conclusions is NOT backfilled - it is
// computed and stored independently by this service's own logic when the monolith's shadow caller
// invokes it, not a 1:1 mirror of the monolith's own table (see MIGRATION_RUNBOOK.md §6k).
//
// Usage:
//   npx tsx scripts/backfill-matching-reasoning-service.ts             (writes for real)
//   npx tsx scripts/backfill-matching-reasoning-service.ts --dry-run    (reports counts only)

import { connectMonolith, connectTarget, backfillTable } from './lib/migrationDb.js';

const TARGET_DB_NAME = process.env.MATCHING_REASONING_SERVICE_DB_NAME || 'tejoma_matching_reasoning';

// skill_edges.from_skill_id/to_skill_id reference skill_nodes(id) - skill_nodes must backfill
// first so the FK on the target database is satisfied.
const SKILL_NODE_COLUMNS = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];
const SKILL_EDGE_COLUMNS = ['id', 'from_skill_id', 'to_skill_id', 'relationship_type', 'weight', 'source', 'created_at'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`=== Backfilling Matching Reasoning Service (${TARGET_DB_NAME}) ${dryRun ? '[DRY RUN]' : ''} ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const nodeResult = await backfillTable(
      source, target,
      { sourceTable: 'skill_nodes', targetTable: 'skill_nodes', columns: SKILL_NODE_COLUMNS },
      dryRun
    );
    const edgeResult = await backfillTable(
      source, target,
      { sourceTable: 'skill_edges', targetTable: 'skill_edges', columns: SKILL_EDGE_COLUMNS },
      dryRun
    );

    console.log('\n=== Summary ===');
    for (const result of [nodeResult, edgeResult]) {
      console.log(`  ${result.table.padEnd(24)} read=${result.read}  ${dryRun ? '' : `written=${result.written}`}`);
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
