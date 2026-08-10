// Validates that Dynamic Weighting / Explainable Matching Service's database is a faithful,
// complete mirror of the monolith's skill_nodes, skill_edges, and role_profiles tables. See
// validate-identity-service-sync.ts's header comment for the full methodology. Exits non-zero on
// any mismatch.
//
// Usage: npx tsx scripts/validate-dynamic-weighting-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.DYNAMIC_WEIGHTING_SERVICE_DB_NAME || 'tejoma_dynamic_weighting';

const SKILL_NODE_COLUMNS = ['id', 'canonical_name', 'category', 'technology_domain', 'aliases', 'popularity_score', 'confidence', 'is_deprecated', 'is_emerging', 'source', 'embedding', 'created_at', 'updated_at'];
const SKILL_EDGE_COLUMNS = ['id', 'from_skill_id', 'to_skill_id', 'relationship_type', 'weight', 'source', 'created_at'];
const ROLE_PROFILE_COLUMNS = ['id', 'role_key', 'display_name', 'mandatory_skills', 'preferred_skills', 'optional_skills', 'common_tools', 'typical_responsibilities', 'preferred_certifications', 'experience_band_min', 'experience_band_max', 'related_roles', 'career_progression', 'embedding', 'source', 'created_at', 'updated_at'];

async function main() {
  console.log(`=== Validating Dynamic Weighting / Explainable Matching Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const skillNodeResult = await compareTable(source, target, {
      sourceTable: 'skill_nodes', targetTable: 'skill_nodes', columns: SKILL_NODE_COLUMNS,
    });
    const skillEdgeResult = await compareTable(source, target, {
      sourceTable: 'skill_edges', targetTable: 'skill_edges', columns: SKILL_EDGE_COLUMNS,
    });
    const roleProfileResult = await compareTable(source, target, {
      sourceTable: 'role_profiles', targetTable: 'role_profiles', columns: ROLE_PROFILE_COLUMNS,
    });

    printCompareResult(skillNodeResult);
    printCompareResult(skillEdgeResult);
    printCompareResult(roleProfileResult);

    const ok = skillNodeResult.ok && skillEdgeResult.ok && roleProfileResult.ok;
    console.log(ok ? '\n✓ Dynamic Weighting / Explainable Matching Service is fully in sync with the monolith.' : '\n✗ Dynamic Weighting / Explainable Matching Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
