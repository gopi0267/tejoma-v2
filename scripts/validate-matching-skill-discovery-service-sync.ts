// Validates that Matching Skill Discovery Service's database is a faithful, complete mirror of the
// monolith's skill_nodes table. See validate-identity-service-sync.ts's header comment for the
// full methodology. skill_discovery_proposals is NOT compared here - see
// backfill-matching-skill-discovery-service.ts's header comment for why. Exits non-zero on any
// mismatch.
//
// Usage: npx tsx scripts/validate-matching-skill-discovery-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.MATCHING_SKILL_DISCOVERY_SERVICE_DB_NAME || 'tejoma_matching_skill_discovery';

const SKILL_NODE_COLUMNS = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];

async function main() {
  console.log(`=== Validating Matching Skill Discovery Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const nodeResult = await compareTable(source, target, {
      sourceTable: 'skill_nodes', targetTable: 'skill_nodes', columns: SKILL_NODE_COLUMNS,
    });

    printCompareResult(nodeResult);

    const ok = nodeResult.ok;
    console.log(ok ? '\n✓ Matching Skill Discovery Service is fully in sync with the monolith.' : '\n✗ Matching Skill Discovery Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
