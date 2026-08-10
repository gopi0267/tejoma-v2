// Validates that Tenant Directory Service's database is a faithful, complete mirror of the
// monolith's companies table. See validate-identity-service-sync.ts's header comment for the
// full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-tenant-directory-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.TENANT_DIRECTORY_DB_NAME || 'tejoma_tenant_directory';

async function main() {
  console.log(`=== Validating Tenant Directory Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'companies',
      targetTable: 'companies',
      columns: ['id', 'name', 'industry', 'plan', 'seats_limit', 'is_active', 'created_at', 'updated_at', 'company_slug', 'logo_url', 'website'],
    });

    printCompareResult(result);
    console.log(result.ok ? '\n✓ Tenant Directory Service is fully in sync with the monolith.' : '\n✗ Tenant Directory Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
