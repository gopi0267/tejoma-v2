// Validates that Recruiting Service's database is a faithful, complete mirror of the monolith's
// recruiter_notifications table. See validate-identity-service-sync.ts's header comment for the
// full methodology. Exits non-zero on any mismatch.
//
// Usage: npx tsx scripts/validate-recruiting-service-sync.ts

import { connectMonolith, connectTarget } from './lib/migrationDb.js';
import { compareTable, printCompareResult } from './lib/compareTable.js';

const TARGET_DB_NAME = process.env.RECRUITING_SERVICE_DB_NAME || 'tejoma_recruiting_service';

const RECRUITER_NOTIFICATION_COLUMNS = ['id', 'user_id', 'company_id', 'match_id', 'type', 'title', 'message', 'read_at', 'created_at'];

async function main() {
  console.log(`=== Validating Recruiting Service sync (${TARGET_DB_NAME}) ===\n`);

  const source = connectMonolith();
  const target = connectTarget(TARGET_DB_NAME);

  try {
    const result = await compareTable(source, target, {
      sourceTable: 'recruiter_notifications', targetTable: 'recruiter_notifications', columns: RECRUITER_NOTIFICATION_COLUMNS,
    });

    printCompareResult(result);
    console.log(result.ok ? '\n✓ Recruiting Service is fully in sync with the monolith.' : '\n✗ Recruiting Service is OUT OF SYNC - see mismatches above. Do not cut over until this passes.');
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
