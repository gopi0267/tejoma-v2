// Validates that Platform Governance Service's database is a faithful, complete mirror of the
// monolith's company_registration_requests table. See validate-identity-service-sync.ts's header
// comment for the full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-platform-governance-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.PLATFORM_GOVERNANCE_DB_NAME || 'tejoma_platform_governance';

async function main() {
  console.log(`=== Validating Platform Governance Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'company_registration_requests',
      targetTable: 'company_registration_requests',
      columns: [
        'id', 'company_name', 'company_website', 'industry', 'company_size', 'business_email',
        'company_phone', 'country', 'state', 'city', 'address', 'admin_name', 'admin_email',
        'admin_phone', 'password_hash', 'status', 'review_notes', 'reviewed_by', 'reviewed_at',
        'resulting_company_id', 'resulting_user_id', 'created_at', 'updated_at',
      ],
    });

    printCompareResult(result);
    console.log(result.ok ? '\n✓ Platform Governance Service is fully in sync with the monolith.' : '\n✗ Platform Governance Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
