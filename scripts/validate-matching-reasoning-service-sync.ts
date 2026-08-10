// Validates that Matching Reasoning Service's database is a faithful, complete mirror of the
// monolith's skill_nodes and skill_edges tables. See validate-identity-service-sync.ts's header
// comment for the full methodology. reasoning_conclusions is NOT compared here - see
// backfill-matching-reasoning-service.ts's header comment for why. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-matching-reasoning-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.MATCHING_REASONING_SERVICE_DB_NAME || 'tejoma_matching_reasoning';

const SKILL_NODE_COLUMNS = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];
const SKILL_EDGE_COLUMNS = ['id', 'from_skill_id', 'to_skill_id', 'relationship_type', 'weight', 'source', 'created_at'];

async function main() {
  console.log(`=== Validating Matching Reasoning Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const nodeResult = await compareTable(source, target, {
      sourceTable: 'skill_nodes', targetTable: 'skill_nodes', columns: SKILL_NODE_COLUMNS,
    });
    const edgeResult = await compareTable(source, target, {
      sourceTable: 'skill_edges', targetTable: 'skill_edges', columns: SKILL_EDGE_COLUMNS,
    });

    printCompareResult(nodeResult);
    printCompareResult(edgeResult);

    const ok = nodeResult.ok && edgeResult.ok;
    console.log(ok ? '\n✓ Matching Reasoning Service is fully in sync with the monolith.' : '\n✗ Matching Reasoning Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
