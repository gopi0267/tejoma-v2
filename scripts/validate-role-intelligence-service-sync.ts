// Validates that Role Intelligence Service's database is a faithful, complete mirror of the
// monolith's role_profiles table. See validate-identity-service-sync.ts's header comment for the
// full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-role-intelligence-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.ROLE_INTELLIGENCE_SERVICE_DB_NAME || 'tejoma_role_intelligence';

const ROLE_PROFILE_COLUMNS = ['id', 'role_key', 'display_name', 'mandatory_skills', 'preferred_skills', 'optional_skills', 'common_tools', 'typical_responsibilities', 'preferred_certifications', 'experience_band_min', 'experience_band_max', 'related_roles', 'career_progression', 'embedding', 'source', 'created_at', 'updated_at'];

async function main() {
  console.log(`=== Validating Role Intelligence Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'role_profiles', targetTable: 'role_profiles', columns: ROLE_PROFILE_COLUMNS,
    });

    printCompareResult(result);

    const ok = result.ok;
    console.log(ok ? '\n✓ Role Intelligence Service is fully in sync with the monolith.' : '\n✗ Role Intelligence Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
